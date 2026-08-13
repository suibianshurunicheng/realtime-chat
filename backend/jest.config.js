/* Unit-test config (pure logic, no DB / Redis / Socket.IO server).
 * Excludes the e2e specs, which run via `test/jest-e2e.json` under `test:e2e`. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  testPathIgnorePatterns: ['\\.e2e-spec\\.ts$', '/node_modules/', '/dist/'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testTimeout: 10000,
};
