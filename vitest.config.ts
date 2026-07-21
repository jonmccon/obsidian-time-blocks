import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['tests/setup.ts'],
	},
	resolve: {
		alias: {
			obsidian: './tests/__mocks__/obsidian.ts',
		},
	},
});
