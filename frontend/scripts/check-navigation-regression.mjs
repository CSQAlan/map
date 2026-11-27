import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createServer as createPortProbe } from 'node:net';

// Start only our own loopback Vite instance. Existing checks intercept API and
// provider requests; this is synthetic regression evidence, not a real backend.
const probe=createPortProbe();
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;
await new Promise(resolve=>probe.close(resolve));
const server=await createServer({configFile:false,envDir:false,plugins:[vue()],server:{host:'127.0.0.1',port,strictPort:true,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]}});
await server.listen();
process.env.UI_BASE_URL=`http://127.0.0.1:${server.httpServer.address().port}`;
process.env.UI_OUTPUT_DIR='../artifacts/navigation-validation/speech-navigation';
try {
  await import('./check-map-lifecycle.mjs');
  await import('./check-speech-navigation.mjs');
} finally {await server.close();}
