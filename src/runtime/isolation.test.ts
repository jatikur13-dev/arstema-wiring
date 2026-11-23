import {describe,it,expect} from 'vitest';
import {browserStorage,replaceMemory,WIRING_PROJECT_STORAGE_KEY} from './storage';
import {loadWiringProject,saveWiringProject} from '../ui/projectRepository';
import {createCircuitProject,emptyBoard} from '../engine/index';
import {createBack,NO_ASSETS} from './services';
import { alamatCermin } from './automaticAssets'
it('isolates storage namespaces without changing the project format',()=>{replaceMemory([]);const a=browserStorage('a'),b=browserStorage('b'),p=createCircuitProject(emptyBoard());saveWiringProject(p,a);expect(loadWiringProject(emptyBoard(),a)).toEqual(p);expect(b.getItem(WIRING_PROJECT_STORAGE_KEY)).toBeNull();});
it('does not treat corrupt stored data as a new savable project',()=>{const raw='{broken';const storage={getItem:()=>raw,setItem:()=>{throw Error('must not write');}};expect(()=>loadWiringProject(emptyBoard(),storage)).toThrow('Data asli dipertahankan');});
it('propagates quota failures rather than claiming a durable save',()=>{expect(()=>saveWiringProject(createCircuitProject(emptyBoard()),{getItem:()=>null,setItem:()=>{throw Error('quota');}})).toThrow('quota');});
it('keeps back registries separate and unregisters each handler',()=>{const a=createBack(),b=createBack();let calls=0;const remove=a.register(1,()=>{calls++;return true;});expect(a.dispatch()).toBe(true);expect(b.dispatch()).toBe(false);remove();expect(a.dispatch()).toBe(false);expect(calls).toBe(1);});
it('has an offline asset fallback that never downloads',async()=>{expect(await NO_ASSETS.assetUrl('wiring-models-3d','anything.glb')).toBeUndefined();expect(await NO_ASSETS.requestDownload(['wiring-models-3d'])).toBe(false);});

describe('cermin paket aset', () => {
  const asli = 'https://ehvefpupveviiahakmbw.supabase.co/storage/v1/object/public/takar-content/packs/wiring-models-3d/1.2.0/abc/contactor.glb'

  it('mengambil bytes dari salinan tuan rumah tanpa mengubah alamat yang ditandatangani', () => {
    expect(alamatCermin(asli, 'https://arstema.com/wiring/paket/')).toBe('https://arstema.com/wiring/paket/packs/wiring-models-3d/1.2.0/abc/contactor.glb')
  })

  it('tetap ke sumber asal bila tuan rumah tidak menyediakan salinan', () => {
    expect(alamatCermin(asli)).toBe(asli)
  })

  it('tidak menyentuh alamat di luar penyimpanan paket — cermin bukan pintu untuk alamat asing', () => {
    const asing = 'https://contoh.invalid/model.glb'
    expect(alamatCermin(asing, 'https://arstema.com/wiring/paket/')).toBe(asing)
  })
})
