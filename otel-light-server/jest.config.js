module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2020",
        },
      },
    ],
  },
  coverageProvider: "v8",
  moduleNameMapper: {
    "^uuid$": "<rootDir>/src/__mocks__/uuid.ts",
  },
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
};
