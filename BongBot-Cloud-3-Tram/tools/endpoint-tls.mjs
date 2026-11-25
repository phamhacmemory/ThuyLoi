import {X509Certificate} from 'node:crypto';
import {get} from 'node:https';
import {getCACertificates} from 'node:tls';

const bundled = getCACertificates('bundled');

export function readEndpoint(url, ca=bundled, options={}) {
  return new Promise((resolve,reject)=>{
    const req=get(url,{ca,rejectUnauthorized:true,signal:AbortSignal.timeout(9000),...options},res=>{
      if (res.statusCode!==200) {
        res.resume();
        reject(Error('endpoint HTTP '+res.statusCode));
        return;
      }
      let peer;
      try { peer=res.socket.getPeerCertificate(true); }
      catch (error) { req.destroy(error); return; }
      const chain=[];
      for (let x=peer; x?.raw && chain.length<12; x=x.issuerCertificate) {
        const cert=new X509Certificate(x.raw);
        if (chain.some(c=>c.fingerprint256===cert.fingerprint256)) break;
        chain.push(cert);
      }
      let data='';
      res.setEncoding('utf8');
      res.on('data',chunk=>{
        data+=chunk;
        if(data.length>4096) req.destroy(Error('endpoint response is too large'));
      });
      res.on('error',reject);
      res.on('end',()=>{
        try { resolve({payload:JSON.parse(data),chain}); }
        catch { reject(Error('endpoint did not return JSON')); }
      });
    });
    req.on('error',reject);
  });
}

export function findTrustAnchor(chain, certificates=bundled) {
  const trusted=certificates.map(pem=>new X509Certificate(pem));
  for (const cert of chain.slice().reverse()) {
    const root=trusted.find(c=>c.ca && (c.fingerprint256===cert.fingerprint256 ||
      (cert.checkIssued(c) && cert.verify(c.publicKey))));
    if (root) return root.toString();
  }
  throw Error('No matching public root CA in the Node.js trust store');
}

export async function verifiedRoot(url) {
  const verify = payload => {
    if (payload.ok!==true || payload.service!=='bongbot-cloud') throw Error('Endpoint is not BongBot Cloud');
  };
  const first = await readEndpoint(url);
  verify(first.payload);
  const pem = findTrustAnchor(first.chain);
  verify((await readEndpoint(url,pem)).payload);
  return pem;
}
