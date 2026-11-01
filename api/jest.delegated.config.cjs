module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: 'mcp-auth/delegated-jupiter-guard\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleNameMapper: { '^uuid$': '<rootDir>/test/uuid.mock.ts' },
};
