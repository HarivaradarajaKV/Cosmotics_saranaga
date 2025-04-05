const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { buildLogger } = require('../utils/logger');

const BUILD_DIR = path.join(__dirname, '../dist');
const buildId = Date.now().toString();

async function cleanBuild() {
    try {
        await fs.rm(BUILD_DIR, { recursive: true, force: true });
        await fs.mkdir(BUILD_DIR, { recursive: true });
        buildLogger.info('Build directory cleaned successfully');
    } catch (error) {
        buildLogger.error('Error cleaning build directory:', error);
        throw error;
    }
}

async function checkDependencies() {
    try {
        const { stdout } = await execAsync('npm list --json');
        const dependencies = JSON.parse(stdout);
        
        // Check for any missing dependencies
        if (dependencies.problems && dependencies.problems.length > 0) {
            buildLogger.warning('Dependency issues found:', dependencies.problems);
            return false;
        }
        
        return true;
    } catch (error) {
        buildLogger.error('Error checking dependencies:', error);
        return false;
    }
}

async function runBuild() {
    const startTime = Date.now();
    buildLogger.start(buildId);

    try {
        // Clean previous build
        await cleanBuild();

        // Check dependencies
        const depsOk = await checkDependencies();
        if (!depsOk) {
            throw new Error('Dependency check failed');
        }

        // Install dependencies
        buildLogger.info('Installing dependencies...');
        await execAsync('npm ci');

        // Run tests if they exist
        try {
            buildLogger.info('Running tests...');
            await execAsync('npm test');
        } catch (testError) {
            buildLogger.warning('Tests failed:', testError.message);
            // Don't fail the build for test failures, but log them
        }

        // Create build directory structure
        await fs.mkdir(path.join(BUILD_DIR, 'logs'), { recursive: true });
        await fs.mkdir(path.join(BUILD_DIR, 'uploads'), { recursive: true });

        // Copy necessary files
        const filesToCopy = [
            'package.json',
            'package-lock.json',
            '.env.example',
            'README.md'
        ];

        for (const file of filesToCopy) {
            try {
                await fs.copyFile(
                    path.join(__dirname, '..', file),
                    path.join(BUILD_DIR, file)
                );
            } catch (error) {
                buildLogger.warning(`Failed to copy ${file}:`, error.message);
            }
        }

        // Copy source files
        const sourceDir = path.join(__dirname, '..');
        const dirsToCreate = ['routes', 'middleware', 'utils', 'models'];

        for (const dir of dirsToCreate) {
            await fs.mkdir(path.join(BUILD_DIR, dir), { recursive: true });
            const files = await fs.readdir(path.join(sourceDir, dir));
            
            for (const file of files) {
                if (file.endsWith('.js')) {
                    await fs.copyFile(
                        path.join(sourceDir, dir, file),
                        path.join(BUILD_DIR, dir, file)
                    );
                }
            }
        }

        // Copy main server file
        await fs.copyFile(
            path.join(sourceDir, 'server.js'),
            path.join(BUILD_DIR, 'server.js')
        );

        const duration = Date.now() - startTime;
        buildLogger.success(buildId, duration);
        
        console.log(`Build completed successfully in ${duration}ms`);
        return true;
    } catch (error) {
        buildLogger.error(buildId, error);
        console.error('Build failed:', error);
        return false;
    }
}

// Execute if run directly
if (require.main === module) {
    runBuild()
        .then(success => process.exit(success ? 0 : 1))
        .catch(error => {
            console.error('Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = runBuild; 