import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' — GitHub Pages 서브경로(cleanNBLM/)에서 상대경로로 동작
export default defineConfig({
  base: './',
  plugins: [react()],
});
