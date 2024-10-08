import replace from '@rollup/plugin-replace';
import typescript from '@rollup/plugin-typescript';
import copy from 'rollup-plugin-copy';

export default {
  input: 'src/service-worker/main.ts',
  output: {file: 'dist/templates/main.js.tmpl', format: 'iife'},
  plugins:
      [
        typescript({
          include: 'src/service-worker/**/*.ts',
        }),
        replace({
          values: {
            'process.env.BOOTSTRAP_NODES': JSON.stringify('{{.BootstrapNodes}}'),
            'process.env.CONTENT_NODE_REFRESH_INTERVAL_MS': 60 * 60 * 1000,  // 1 hour
            'process.env.CONTENT_NODES': JSON.stringify('{{.ContentNodes}}'),
            'process.env.PROJECT_ID': JSON.stringify('{{.ProjectID}}'),
          },
          preventAssignment: true,
        }),
        copy({
          targets: [
            {src: 'src/landing-page/*', dest: 'dist/public'},
          ],
        }),
      ]
};
