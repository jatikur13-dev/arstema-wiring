import type { WiringAssets } from './services'
import publicKey from './contentPublicKey.json'

const PREFIX = 'https://ehvefpupveviiahakmbw.supabase.co/storage/v1/object/public/takar-content/'

/**
 * Menyalin alamat berkas paket ke cermin milik tuan rumah.
 *
 * Manifest ditandatangani beserta alamat aslinya, jadi alamat itu TIDAK boleh
 * diubah sebelum tanda tangannya diperiksa. Yang ditukar hanya tempat mengambil
 * bytes-nya; keaslian isi tetap dijamin sha256 tiap berkas. Dengan begini situs
 * yang memasang Wiring bisa menyajikan modelnya sendiri — model selalu ada,
 * tidak bergantung layanan luar — tanpa melonggarkan satu pun pemeriksaan.
 */
export function alamatCermin(url: string, mirror?: string): string {
  return mirror && url.startsWith(PREFIX) ? mirror + url.slice(PREFIX.length) : url
}
interface File { path: string; url: string; sha256: string; bytes: number; mime: string }
interface Manifest { id: string; files: File[]; downloadBytes: number; installedBytes: number; signature: { value: string; algorithm: string; keyId: string } }
const canonical = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
const digest = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
async function bounded(url: string, limit: number): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), credentials: 'omit' })
  if (!response.ok || !response.body) throw Error(`Aset gagal dimuat (${response.status})`)
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw Error('Ukuran aset melampaui batas'); chunks.push(value) } }
  finally { await reader.cancel() }
  const result = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result.buffer
}

/**
 * Browser/JS consumer: verify the signed manifest and fetch only visible files.
 *
 * `mirror` (opsional) menunjuk salinan paket yang sama di tempat lain — misalnya
 * `/wiring/paket/` di situs yang memasangnya. Manifest, tanda tangan, dan sha256
 * tetap diperiksa persis seperti biasa; hanya alamat pengambilannya yang pindah.
 */
export function createAutomaticAssets(mirror?: string): WiringAssets & { dispose(): void } {
  /* Cermin dicoba lebih dulu, sumber asal jadi jaring pengaman. Tuan rumah boleh
     menyajikan sebagian paket saja — mis. hanya model 3D — tanpa membuat paket
     lain yang tidak ia simpan ikut gagal. Isi tetap dijamin sha256, dari mana pun
     bytes-nya datang. */
  async function ambil(url: string, limit: number) {
    const cermin = alamatCermin(url, mirror)
    if (cermin === url) return bounded(url, limit)
    try { return await bounded(cermin, limit) } catch { return bounded(url, limit) }
  }
  const manifests = new Map<string, Promise<Manifest>>(), urls = new Map<string, Promise<string>>()
  const progress = new Map<string, { state: string }>(), blobs = new Set<string>()
  let disposed = false
  async function manifest(id: string) {
    if (!/^wiring-(virtual|models-3d)$/.test(id)) throw Error('Paket bukan aset Wiring')
    if (!manifests.has(id)) manifests.set(id, (async () => {
      const m = JSON.parse(new TextDecoder().decode(await ambil(`${PREFIX}manifests/${id}/latest.json`, 2 * 1024 * 1024))) as Manifest
      const { signature, ...payload } = m
      if (m.id !== id || !Array.isArray(m.files) || m.files.length > 2048 || signature?.algorithm !== 'ECDSA_P256_SHA256' || signature.keyId !== 'takar-content-2026-01') throw Error('Manifest Wiring tidak valid')
      const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      const sig = Uint8Array.from(atob(signature.value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
      if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, new TextEncoder().encode(canonical(payload)))) throw Error('Tanda tangan aset tidak valid')
      for (const f of m.files) {
        const url = new URL(f.url)
        if (!url.href.startsWith(`${PREFIX}packs/${id}/`) || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isInteger(f.bytes) || f.bytes < 1 || f.bytes > 8 * 1024 * 1024 || !['image/webp', 'model/gltf-binary'].includes(f.mime)) throw Error('File aset tidak valid')
      }
      const total=m.files.reduce((sum,f)=>sum+f.bytes,0),unique=[...new Map(m.files.map(f=>[f.sha256,f.bytes])).values()].reduce((sum,n)=>sum+n,0)
      if(total!==m.downloadBytes||unique!==m.installedBytes||new Set(m.files.map(f=>f.path)).size!==m.files.length)throw Error('Ukuran atau daftar file manifest tidak konsisten')
      return m
    })().catch(error => { manifests.delete(id); throw error }))
    return manifests.get(id)!
  }
  return {
    delivery: 'automatic', subscribe: () => () => {}, snapshot: () => progress, initialize: async () => {}, requestDownload: async () => false,
    async assetUrl(id, path) {
      const cacheKey = `${id}:${path}`
      if (!urls.has(cacheKey)) urls.set(cacheKey, (async () => {
        const m = await manifest(id), f = m.files.find(f => f.path === path)
        if (!f) throw Error(`Aset belum tercantum: ${path}`)
        const bytes = await ambil(f.url, f.bytes)
        if (bytes.byteLength !== f.bytes || await digest(bytes) !== f.sha256) throw Error('Checksum aset tidak cocok')
        if (disposed) throw Error('Tampilan telah ditutup')
        const url = URL.createObjectURL(new Blob([bytes], { type: f.mime })); blobs.add(url); return url
      })().catch(error => { urls.delete(cacheKey); throw error }))
      return urls.get(cacheKey)!
    },
    dispose() { disposed = true; blobs.forEach(url => URL.revokeObjectURL(url)); blobs.clear(); urls.clear(); manifests.clear() },
  }
}
