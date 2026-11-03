import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('../generated/',import.meta.url),{recursive:true});
await build({stdin:{contents:"import {Buffer} from 'buffer/';globalThis.Buffer=Buffer;",resolveDir:new URL('../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')},bundle:true,platform:'browser',format:'iife',minify:true,outfile:new URL('../generated/lx-buffer.js',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
