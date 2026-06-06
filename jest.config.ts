import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/worker/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Minimal tsconfig for tests — avoid Next.js specific settings
          strict: true,
          esModuleInterop: true,
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'es2020',
          lib: ['es2020'],
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  passWithNoTests: true,
};

export default config;
