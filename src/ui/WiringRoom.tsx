import { forwardRef,useId,useImperativeHandle,useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {useWiringServices} from '../runtime/services';
import {
  WIRING_STANDARD_PROFILES,
  checkCircuitProject,
  computeCircuitProjectHash,
  emptyBoard,
  setCircuitProjectStatus,
  updateCircuitProject,
  type Board,
  type CircuitElectricalSystem,
  type CircuitGroundingSystem,
  type CircuitProject,
} from "../engine/index";
import { CircuitLabPage } from "../lab/CircuitLabPage";
import { useBack } from "../runtime/back";
import {
  loadWiringProject,
  parseImportedWiringProject,
  saveWiringProject,
  wiringProjectExportJson,
} from "./projectRepository";
import "./WiringRoom.css";

type SaveState = "SAVED" | "SAVING" | "ERROR";

const STATUS_LABEL: Record<CircuitProject["status"], string> = {
  DRAFT: "Draft",
  APP_CHECKED: "App checked",
  OWNER_ACCEPTED: "Owner accepted",
  PRO_REVIEWED_OFFLINE: "Reviewed offline",
};

const SAVE_LABEL: Record<SaveState, string> = {
  SAVED: "Tersimpan lokal",
  SAVING: "Menyimpan…",
  ERROR: "Gagal menyimpan",
};

function downloadJson(filename: string, payload: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface WiringHandle {getProject():CircuitProject;loadProject(value:unknown):boolean}
/**
 * Bingkai yang disediakan tuan rumah (situs ARSTEMA, keputusan pemilik 6 Okt 2026). Semua bawaan menampilkan bagian itu.
 * - backButton false: tuan rumah sudah punya tombol kembali sendiri, jadi tidak ada dua tombol bertumpuk.
 * - projectPanel false: panel Proyek & standar disembunyikan; proyek tetap tersimpan otomatis dengan kunci yang sama.
 * - zoomControls 'fine-pointer': tombol zoom hanya untuk mouse/trackpad.
 */
export interface WiringChrome {backButton?:boolean;projectPanel?:boolean;zoomControls?:'always'|'fine-pointer'}
export const WiringRoom=forwardRef<WiringHandle,{onClose:()=>void;onChange?:(project:CircuitProject)=>void;chrome?:WiringChrome}>(function WiringRoom({ onClose,onChange,chrome },ref) {
  const projectPanel=chrome?.projectPanel!==false;
  const {storage,onError}=useWiringServices();
  const titleId=useId();
  const [loadError]=useState<{error?:Error}>(()=>({}));
  const [project, setProject] = useState(() => {try{return loadWiringProject(emptyBoard(),storage);}catch(error){loadError.error=error as Error;return loadWiringProject(emptyBoard(),{getItem:()=>null,setItem:()=>{}});}});
  useEffect(()=>{if(loadError.error)onError(loadError.error);},[loadError,onError]);
  const latestProject = useRef(project);
  latestProject.current = project;
  useEffect(() => {
    const flush = () => {
      if(loadError.error)return;
      try { saveWiringProject(latestProject.current,storage); }
      catch(error) { onError(error as Error); }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [storage,onError,loadError]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(loadError.error?'ERROR':'SAVED');
  const [nameDraft, setNameDraft] = useState(project.name);
  const [importError, setImportError] = useState("");
  const [labEpoch, setLabEpoch] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useImperativeHandle(ref,()=>({getProject:()=>JSON.parse(JSON.stringify(latestProject.current)),loadProject(value){let parsed:CircuitProject|null;try{parsed=parseImportedWiringProject(typeof value==='string'?value:JSON.stringify(value));}catch{return false;}if(!parsed)return false;loadError.error=undefined;latestProject.current=parsed;setProject(parsed);setNameDraft(parsed.name);setLabEpoch(v=>v+1);return true;}}),[loadError]);
  useEffect(()=>{onChange?.(project);},[project,onChange]);

  useBack(50, () => {
    if (sheetOpen) {
      setSheetOpen(false);
      return true;
    }
    onClose();
    return true;
  });

  useEffect(() => {
    if(loadError.error)return;
    setSaveState("SAVING");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        saveWiringProject(project,storage);
        setSaveState("SAVED");
      } catch(error) {
        setSaveState("ERROR");
        onError(error as Error);
      }
    }, 180);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [project,storage,onError,loadError]);

  const check = useMemo(() => checkCircuitProject(project), [project]);

  const onBoardChange = useCallback((board: Board) => {
    setProject((current) => {
      if (current.board === board) return current;
      const previous=current.board;
      const viewOnly=previous.components===board.components && previous.wires===board.wires && previous.domain===board.domain && previous.reference===board.reference && previous.mechanicalInterlocks===board.mechanicalInterlocks;
      return viewOnly ? {...current,board} : updateCircuitProject(current, { board });
    });
  }, []);

  const applyName = useCallback(() => {
    setProject((current) => nameDraft.trim() === current.name
      ? current
      : updateCircuitProject(current, { name: nameDraft }));
  }, [nameDraft]);

  const updateSystem = useCallback((patch: { electricalSystem?: CircuitElectricalSystem; groundingSystem?: CircuitGroundingSystem }) => {
    setProject((current) => updateCircuitProject(current, patch));
  }, []);

  const exportProject = useCallback(() => {
    downloadJson(`${project.name.replace(/[^a-z0-9_-]+/gi, "-") || "wiring"}.takar-wiring.json`, wiringProjectExportJson(project));
  }, [project]);

  const exportReviewHash = useCallback(async () => {
    try {
    const sha256 = await computeCircuitProjectHash(project);
    downloadJson(`${project.id}-review-hash.json`, JSON.stringify({
      format: "TAKAR_WIRING_HASH_V1",
      projectId: project.id,
      revision: project.revision,
      status: project.status,
      standardProfile: project.standardProfile,
      sha256,
      generatedAt: new Date().toISOString(),
      semanticCheck: { errors: check.errors.length, warnings: check.warnings.length, info: check.info.length },
      disclaimer: "Hash mengunci revisi proyek; bukan sertifikasi, tanda tangan digital, atau persetujuan regulator.",
    }, null, 2));
    }catch(error){onError(error as Error);}
  }, [check, project,onError]);

  const importProject = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
    const imported = parseImportedWiringProject(await file.text());
    if (!imported) {
      setImportError("File bukan proyek Wiring TAKAR yang valid.");
      return;
    }
    setImportError("");
    loadError.error=undefined;
    setProject(imported);
    setNameDraft(imported.name);
    setLabEpoch((value) => value + 1);
    }catch(error){setImportError('File tidak dapat dibaca. Proyek aktif tidak berubah.');onError(error as Error);}
  }, [loadError,onError]);

  return (
    <div className="wiring-room">
      <CircuitLabPage
        key={labEpoch}
        initialBoard={project.board}
        variant="takar"
        onClose={onClose}
        onBoardChange={onBoardChange}
        projectSummary={projectPanel ? {
          name: project.name,
          status: STATUS_LABEL[project.status],
          saveLabel: SAVE_LABEL[saveState],
        } : undefined}
        onOpenProject={projectPanel ? () => setSheetOpen(true) : undefined}
        showBack={chrome?.backButton !== false}
        zoomControls={chrome?.zoomControls}
      />
      {projectPanel && sheetOpen && (
        <>
          <button
            type="button"
            className="wiring-project-backdrop"
            aria-label="Tutup proyek Wiring"
            onClick={() => { applyName(); setSheetOpen(false); }}
          />
          <section className="wiring-project-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <header className="wiring-project-sheet__head">
              <div>
                <span className="wiring-project-sheet__eyebrow">PROYEK OFFLINE</span>
                <h2 id={titleId}>Proyek &amp; standar</h2>
              </div>
              <button type="button" aria-label="Tutup panel proyek" onClick={() => { applyName(); setSheetOpen(false); }}>×</button>
            </header>

            <label className="wiring-project-field">
              <span>Nama proyek</span>
              <input value={nameDraft} maxLength={80} onChange={(event) => setNameDraft(event.target.value)} onBlur={applyName} />
            </label>

            <div className="wiring-project-meta" aria-label="Status penyimpanan proyek">
              <span data-save-state={saveState}>{SAVE_LABEL[saveState]}</span>
              <span>Revisi {project.revision}</span>
              <span>{STATUS_LABEL[project.status]}</span>
            </div>

            <fieldset className="wiring-project-section">
              <legend>Profil standar</legend>
              <div className="wiring-standard-list">
                {Object.values(WIRING_STANDARD_PROFILES).map((profile) => (
                  <label
                    key={profile.id}
                    data-availability={profile.availability}
                    data-selected={project.standardProfile === profile.id || undefined}
                  >
                    <input
                      type="radio"
                      name="wiring-standard"
                      checked={project.standardProfile === profile.id}
                      disabled={profile.availability !== "AVAILABLE"}
                      readOnly
                    />
                    <span><strong>{profile.shortLabel}</strong><small>{profile.note}</small></span>
                    <em>{profile.availability === "AVAILABLE" ? "AKTIF" : "Belum tersedia"}</em>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="wiring-project-fields-row">
              <label className="wiring-project-field">
                <span>Sistem listrik</span>
                <select value={project.electricalSystem} onChange={(event) => updateSystem({ electricalSystem: event.target.value as CircuitElectricalSystem })}>
                  <option value="CONTROL_MIXED">Control / mixed</option>
                  <option value="AC_1PH_2W">AC 1 fasa 2 kawat</option>
                  <option value="AC_1PH_3W">AC 1 fasa 3 kawat</option>
                  <option value="AC_3PH_3W">AC 3 fasa 3 kawat</option>
                  <option value="AC_3PH_4W">AC 3 fasa 4 kawat</option>
                  <option value="DC_2W">DC 2 kawat</option>
                </select>
              </label>
              <label className="wiring-project-field">
                <span>Pembumian</span>
                <select value={project.groundingSystem} onChange={(event) => updateSystem({ groundingSystem: event.target.value as CircuitGroundingSystem })}>
                  <option value="NOT_DECLARED">Belum ditetapkan</option>
                  <option value="TT">TT</option><option value="TN_S">TN-S</option><option value="TN_C">TN-C</option>
                  <option value="TN_C_S">TN-C-S</option><option value="IT">IT</option>
                </select>
              </label>
            </div>

            <div className="wiring-project-summary">
              <article><span>Semantic check</span><strong data-valid={check.acceptable}>{check.errors.length} error</strong><small>{check.warnings.length} warning · {check.info.length} info</small></article>
            </div>

            {check.errors.length > 0 && (
              <div className="wiring-project-errors" role="alert">
                <strong>Belum lolos pemeriksaan aplikasi</strong>
                <ul>{check.errors.slice(0, 4).map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
              </div>
            )}

            <div className="wiring-project-status-actions">
              <button type="button" disabled={!check.acceptable} onClick={() => setProject((current) => setCircuitProjectStatus(current, "APP_CHECKED"))}>Periksa aplikasi</button>
              <button type="button" disabled={project.status !== "APP_CHECKED"} onClick={() => setProject((current) => setCircuitProjectStatus(current, "OWNER_ACCEPTED"))}>Terima sebagai pemilik</button>
            </div>
            <p className="wiring-project-disclaimer">Owner accepted berarti pemilik menerima revisi ini. Status tersebut bukan sertifikasi desain, verifikasi instalasi, atau persetujuan regulator.</p>

            <div className="wiring-project-export-actions">
              <button type="button" onClick={exportProject}>Ekspor proyek</button>
              <label>Impor proyek<input type="file" accept="application/json,.json" onChange={importProject} /></label>
              <button type="button" onClick={() => void exportReviewHash()}>Ekspor hash review</button>
            </div>
            {importError && <p className="wiring-project-import-error" role="alert">{importError}</p>}
          </section>
        </>
      )}
    </div>
  );
});
