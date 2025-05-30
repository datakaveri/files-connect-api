/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/server.ts',
    '!src/__tests__/**/*',
    '!src/config/**/*',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      isolatedModules: true,
      diagnostics: {
        ignoreCodes: [151001]
      }
    }]
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/utils/jest.setup.js'],
  testTimeout: 30000, // 30 seconds timeout for tests
  verbose: true,
  testEnvironmentOptions: {
    NODE_ENV: 'test'
  },
  globals: {
    'ts-jest': {
      isolatedModules: true
    }
  },
  // Handle TypeScript path aliases if any
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};
