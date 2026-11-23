import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PALETTE } from "../lab/scenario/topic1a";
import { emptyBoard } from "../engine/index";
import { WiringRoom } from "./WiringRoom";
import { useZoomControls } from "../lab/CircuitLabPage";

const wiringCss = readFileSync(new URL("./WiringRoom.css", import.meta.url), "utf8");

describe("Wiring room", () => {
  it("dibuka sebagai editor fullscreen dengan papan kosong", () => {
    const markup = renderToStaticMarkup(<WiringRoom onClose={() => undefined} />);
    expect(markup).toContain("Simulator lokal");
    expect(markup).toContain("Komponen");
    expect(markup).toContain('aria-label="Buka proyek dan standar Wiring"');
    expect(markup).toContain("Proyek Wiring");
    expect(markup).toContain("Draft");
    expect(markup).toContain('aria-label="Cari komponen Wiring"');
    expect(markup).toContain("Papan Virtual · Unduh");
    expect(markup).toContain("Diagram IEC 60617");
    expect(markup).toContain("Animasi kabel");
    expect(markup).toContain("Aktif tanpa unduhan");
    expect(markup).not.toContain("Contoh rangkaian</option>");
    expect(markup.match(/<svg class="as-lab-board"/g)).toHaveLength(1);
    const svgTags = markup.match(/<svg class="as-lab-board"[^>]*>/g) ?? [];
    expect(svgTags[0]).toContain('data-projection="iec"');
    expect(svgTags.some((tag) => tag.includes('data-projection="virtual"'))).toBe(false);
    expect(markup).not.toMatch(/<img\b/);
    expect(emptyBoard()).toEqual({ components: {}, wires: {} });
  });

  it("membiarkan grid memenuhi workspace dan menumpangkan dock zoom di atasnya", () => {
    const workspaceRule = wiringCss.match(
      /\.as-lab--takar \.as-lab__workspace\s*\{([\s\S]*?)\}/,
    )?.[1] ?? "";
    expect(workspaceRule).toContain("padding: 0");
    expect(workspaceRule).not.toContain("var(--wiring-control-dock-right)");
    expect(wiringCss).toMatch(/\.as-lab--takar \.as-lab__zoom\s*\{[\s\S]*?position:\s*absolute/);
  });

  it("menyediakan pemilih Virtual/IEC yang tersinkron di panel komponen", () => {
    const markup = renderToStaticMarkup(<WiringRoom onClose={() => undefined} />);
    expect(markup).toContain('aria-label="Pilih papan dari panel komponen"');
    expect(markup).toContain('aria-label="Pilih papan"');
    expect(markup.match(/Papan Virtual · Unduh/g)).toHaveLength(2);
    expect(markup.match(/Diagram IEC 60617/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("chrome dari tuan rumah: tanpa tombol kembali kedua dan tanpa panel proyek (pemilik, 6 Okt 2026)", () => {
    const bawaan = renderToStaticMarkup(<WiringRoom onClose={() => undefined} />);
    expect(bawaan).toContain('aria-label="Kembali dari Wiring"');
    expect(bawaan).not.toContain("data-host-back");
    const situs = renderToStaticMarkup(
      <WiringRoom onClose={() => undefined} chrome={{ backButton: false, projectPanel: false, zoomControls: "fine-pointer" }} />,
    );
    expect(situs).not.toContain('aria-label="Kembali dari Wiring"');
    expect(situs).not.toContain('aria-label="Buka proyek dan standar Wiring"');
    expect(situs).not.toContain("Proyek Wiring");
    expect(situs).toMatch(/<header class="as-lab__appbar" data-host-back="">/);
    expect(situs).toContain("Simulator lokal");
    expect(wiringCss).toMatch(/\.as-lab__appbar\[data-host-back\]\s*\{\s*padding-left:\s*16px/);
  });

  it("tombol zoom 'fine-pointer' hanya untuk mouse/trackpad", () => {
    function Uji({ mode }: { mode: "always" | "fine-pointer" }) {
      return <span>{String(useZoomControls(mode))}</span>;
    }
    const asli = Object.getOwnPropertyDescriptor(globalThis, "window");
    const pakai = (fine: boolean) =>
      Object.defineProperty(globalThis, "window", { value: { matchMedia: () => ({ matches: fine }) }, configurable: true });
    try {
      pakai(false);
      expect(renderToStaticMarkup(<Uji mode="fine-pointer" />)).toBe("<span>false</span>");
      expect(renderToStaticMarkup(<Uji mode="always" />)).toBe("<span>true</span>");
      pakai(true);
      expect(renderToStaticMarkup(<Uji mode="fine-pointer" />)).toBe("<span>true</span>");
    } finally {
      if (asli) Object.defineProperty(globalThis, "window", asli);
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("menyediakan palette industri lintas kategori dengan terminal nyata", () => {
    const kinds = new Set(PALETTE.map((item) => item.spec.kind));
    expect(PALETTE).toHaveLength(64);
    expect(kinds.has("RELAY")).toBe(true);
    expect(kinds.has("CONTACTOR")).toBe(true);
    expect(kinds.has("OVERLOAD_RELAY")).toBe(true);
    expect(kinds.has("TIMER")).toBe(true);
    expect(kinds.has("MOTOR_3PH")).toBe(true);
    expect(kinds.has("LIMIT_SWITCH")).toBe(true);
    expect(kinds.has("SENSOR_3WIRE")).toBe(true);
    expect(kinds.has("TERMINAL_BLOCK")).toBe(true);
    expect(PALETTE.some((item) => item.key === "BATTERY_24V")).toBe(true);
    expect(PALETTE.some((item) => item.key === "SOLENOID_VXE21")).toBe(true);
    expect(PALETTE.some((item) => item.key === "DIN_PSU_HDR3024")).toBe(true);
    expect(PALETTE.some((item) => item.key === "TIMER_H3CR_A8")).toBe(true);
    expect(PALETTE.some((item) => item.key === "MOTOR_BREAKER_GV2ME14")).toBe(true);
    expect(PALETTE.some((item) => item.key === "TERMINAL_UT25_PE_LL")).toBe(true);
    expect(
      PALETTE.flatMap((item) => item.spec.kind === "RELAY" ? [item.spec.model] : []),
    ).toEqual([
      "OMRON_MY2_8PIN",
      "OMRON_MY3_11PIN",
      "OMRON_MY4_14PIN",
      "OMRON_G5V2_8PIN",
    ]);
  });
});
