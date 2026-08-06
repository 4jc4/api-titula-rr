export default {
  testEnvironment: 'node',
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: String.raw`.*\.e2e-spec\.ts$`,
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    [String.raw`^(\.{1,2}/.*)\.js$`]: '$1',
  },
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { useESM: true }],
  },
  testTimeout: 30000,
};
