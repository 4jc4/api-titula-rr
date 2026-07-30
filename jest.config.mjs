export default {
  testEnvironment: 'node',
  rootDir: 'src',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: String.raw`.*\.spec\.ts$`,
  // ESM: trata .ts como módulo ES e resolve os imports terminados em .js
  // (convenção NodeNext) de volta para os .ts de origem
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    [String.raw`^(\.{1,2}/.*)\.js$`]: '$1',
  },
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { useESM: true }],
  },
};
