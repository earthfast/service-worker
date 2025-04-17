import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import typescript from '@rollup/plugin-typescript';
import copy from 'rollup-plugin-copy';
import filesize from 'rollup-plugin-filesize';

export default {
  input: 'src/service-worker/main.ts',
  output: {
    file: 'dist/templates/main.js.tmpl',
    format: 'iife',
    inlineDynamicImports: true,
  },
  plugins:
      [
        resolve({browser: true}),
        commonjs(),
        typescript({include: 'src/service-worker/**/*.ts'}),
        replace({
          values: {
            'process.env.BOOTSTRAP_NODES': JSON.stringify('{{.BootstrapNodes}}'),
            'process.env.CONTENT_NODE_REFRESH_INTERVAL_MS': 60 * 60 * 1000,
            'process.env.CONTENT_NODES': JSON.stringify('{{.ContentNodes}}'),
            'process.env.PROJECT_ID': JSON.stringify('{{.ProjectID}}'),
          },
          preventAssignment: true,
        }),
        copy({targets: [{src: 'src/landing-page/*', dest: 'dist/public'}]}),
        filesize(),
      ]
};
