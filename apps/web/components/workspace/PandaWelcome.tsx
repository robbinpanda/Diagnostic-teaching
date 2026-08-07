"use client";

import { useEffect, useRef, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { PandaHeroArtwork } from "./PandaArtwork";

const TITLE = "今天你想要解决什么问题？";

type BambooPlantProps = {
  className: string;
};

function BambooPlant({ className }: BambooPlantProps) {
  return (
    <g className={`bambooPlant ${className}`}>
      <g className="bambooStem">
        <path d="M38.486 38.786 85.807 21.813c12.676 51.777 21.595 76.782 38.745 118.618L77.231 157.404C66.433 109.526 58.24 83.451 38.486 38.786Z" />
        <rect width="59.419" height="20.556" rx="10.278" transform="matrix(.929132 -.333247 .311551 .95382 32.941 35.298)" />
        <rect width="59.419" height="20.556" rx="10.278" transform="matrix(.929132 -.333247 .311551 .95382 70.085 149.015)" />
        <path d="m86.302 182.946 47.321-16.973c12.676 51.777 21.595 76.782 38.745 118.618l-47.321 16.973c-10.798-47.877-18.991-73.953-38.745-118.618Z" />
        <rect width="59.419" height="20.556" rx="10.278" transform="matrix(.929132 -.333246 .311551 .95382 80.757 179.458)" />
        <rect width="59.419" height="20.556" rx="10.278" transform="matrix(.929132 -.333247 .311551 .95382 117.901 293.175)" />
        <path d="m136.437 325.956 44.75-16.05c13.107 52.388 22.101 77.75 39.272 120.232l-44.75 16.05c-11.24-48.423-19.564-74.846-39.272-120.232Z" />
        <rect width="56.191" height="20.835" rx="10.418" transform="matrix(.929132 -.333246 .311551 .95382 131.085 322.326)" />
        <rect width="56.191" height="20.835" rx="10.418" transform="matrix(.929132 -.333247 .311551 .95382 168.734 437.589)" />
      </g>
      <g className="bambooLeaves">
        <path d="M27.802 356.901c.259-2.455 2.278-4.192 4.718-4.06l44.41 2.416c7.045.383 14.082 1.702 20.933 3.925l44.105 14.312c1.846.599 3.076 2.477 2.875 4.388-.204 1.923-1.793 3.278-3.705 3.157l-49.836-3.147a57.8 57.8 0 0 1-11.985-2.034L31.7 362.6c-2.473-.688-4.166-3.163-3.898-5.699Z" />
        <path d="M15.248 169.153c.721-2.32 2.848-3.617 5.145-3.138l17.229 3.593c6.237 1.3 12.264 4.201 17.582 8.46l15.39 12.327c1.547 1.239 2.236 3.403 1.666 5.236-.576 1.855-2.289 2.879-4.124 2.466l-21.78-4.911a41.7 41.7 0 0 1-10.533-4.673l-18.13-12.481c-2.176-1.498-3.212-4.412-2.445-6.879Z" />
      </g>
    </g>
  );
}

type PandaWelcomeProps = {
  phase: "visible" | "leaving";
  characterRef: RefObject<SVGGElement | null>;
};

export function PandaWelcome({ phase, characterRef }: PandaWelcomeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pointerTarget = useRef({ x: 0, y: 0 });
  const pointerCurrent = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const root = rootRef.current;
    if (!root || phase === "leaving") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const tick = () => {
      const current = pointerCurrent.current;
      const target = pointerTarget.current;
      current.x += (target.x - current.x) * 0.075;
      current.y += (target.y - current.y) * 0.075;
      root.style.setProperty("--panda-look-x", `${current.x.toFixed(2)}px`);
      root.style.setProperty("--panda-look-y", `${current.y.toFixed(2)}px`);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (phase === "leaving") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    pointerTarget.current = {
      x: Math.max(-1, Math.min(1, x)) * 7,
      y: Math.max(-1, Math.min(1, y)) * 4
    };
  }

  function resetPointer() {
    pointerTarget.current = { x: 0, y: 0 };
  }

  return (
    <div
      ref={rootRef}
      className={`pandaWelcome pandaWelcome-${phase}`}
      data-panda-welcome={phase}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
    >
      <div className="pandaHalftone" aria-hidden="true" />

      <svg className="pandaBambooScene" viewBox="0 0 430 560" aria-hidden="true" focusable="false">
        <BambooPlant className="bambooLarge" />
        <BambooPlant className="bambooSmallOne" />
        <BambooPlant className="bambooSmallTwo" />
      </svg>

      <div className="pandaWelcomeCopy">
        <h1 aria-label={TITLE}>
          {Array.from(TITLE).map((character, index) => (
            <span
              aria-hidden="true"
              className="pandaTitleGlyph"
              key={`${character}-${index}`}
              style={{ "--glyph-index": index } as CSSProperties}
            >
              {character}
            </span>
          ))}
        </h1>
        <p>
          <span>上传题目图片，熊猫会帮你理清当时错误思路，</span>
          <br />
          <span>陪你梳理真实思考逻辑顺序！</span>
        </p>
      </div>

      <div className="pandaHeroStage" data-panda-hero-source>
        <PandaHeroArtwork characterRef={characterRef} />
      </div>
    </div>
  );
}
