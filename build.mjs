import {build,transformWithEsbuild} from 'vite';import {fileURLToPath} from 'node:url';import {dirname,resolve} from 'node:path';import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';
const root=dirname(fileURLToPath(import.meta.url));
// Vite lib mode keeps whitespace in ES output (its own minify pass runs last and forces
// that) so library consumers can tree-shake. The browser build is a finished page bundle
// (arstema.com/wiring), so every emitted .js file, the routing worker included, is
// minified once the bundle is complete.
const minifyBundle={name:'minify-browser-bundle',async generateBundle(_options,bundle){for(const file of Object.values(bundle)){if(!file.fileName.endsWith('.js'))continue;const code=file.type==='chunk'?file.code:typeof file.source==='string'?file.source:new TextDecoder().decode(file.source);const out=(await transformWithEsbuild(code,file.fileName,{minify:true,format:'esm'})).code;if(file.type==='chunk')file.code=out;else file.source=out;}}};
for(const [name,entry] of [['engine','engine/index.ts'],['react','react.tsx'],['browser','browser.tsx']])await build({configFile:false,root,base:'./',publicDir:false,define:{'process.env.NODE_ENV':'"production"'},esbuild:{jsx:'automatic'},plugins:name==='browser'?[minifyBundle]:[],worker:{format:'es'},build:{outDir:resolve(root,'dist',name),emptyOutDir:true,lib:{entry:resolve(root,'src',entry),formats:['es'],fileName:name},rollupOptions:{external:name==='react'?id=>/^(react|react-dom)(\/|$)/.test(id):[],output:{assetFileNames:'[name][extname]'}}}});
const result=spawnSync(process.execPath,[createRequire(import.meta.url).resolve('typescript/bin/tsc'),'-p',resolve(root,'tsconfig.json')],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
