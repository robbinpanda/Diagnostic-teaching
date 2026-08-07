"use client";

import { useEffect, useRef, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { PandaHeroArtwork } from "./PandaArtwork";

const TITLE = "今天你想要解决什么问题？";
const PANDA_ENTRANCE_DELAY_MS = 550;

type Spring = {
  value: number;
  target: number;
  velocity: number;
  stiffness: number;
  damping: number;
  mass: number;
};

function createSpring(value: number, stiffness: number, damping: number): Spring {
  return { value, target: 0, velocity: 0, stiffness, damping, mass: 1 };
}

function stepSpring(spring: Spring, deltaSeconds: number) {
  const displacement = spring.value - spring.target;
  const force = -spring.stiffness * displacement - spring.damping * spring.velocity;
  spring.velocity += (force / spring.mass) * deltaSeconds;
  spring.value += spring.velocity * deltaSeconds;
}

function resetSpring(spring: Spring, value: number, velocity = 0) {
  spring.value = value;
  spring.velocity = velocity;
  spring.target = 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

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
  const artworkRef = useRef<SVGSVGElement | null>(null);
  const pointerTarget = useRef({ x: 0, y: 0 });
  const pointerCurrent = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const root = rootRef.current;
    const artwork = artworkRef.current;
    if (!root || !artwork) return;
    if (phase === "leaving") {
      delete root.dataset.pandaEntrance;
      return;
    }

    const book = artwork.querySelector<SVGGElement>('[data-panda-part="book"]');
    const bookShadow = artwork.querySelector<SVGGElement>('[data-panda-part="book-shadow"]');
    const pandaShadow = artwork.querySelector<SVGGElement>('[data-panda-part="panda-shadow"]');
    const pandaBody = artwork.querySelector<SVGGElement>('[data-panda-part="body"]');
    const earLeft = artwork.querySelector<SVGGElement>('[data-panda-part="ear-left"]');
    const earRight = artwork.querySelector<SVGGElement>('[data-panda-part="ear-right"]');
    const armLeft = artwork.querySelector<SVGGElement>('[data-panda-part="arm-left"]');
    const armRight = artwork.querySelector<SVGGElement>('[data-panda-part="arm-right"]');
    const tail = artwork.querySelector<SVGGElement>('[data-panda-part="tail"]');

    if (!book || !bookShadow || !pandaShadow || !pandaBody || !earLeft || !earRight || !armLeft || !armRight || !tail) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      root.dataset.pandaEntrance = "settled";
      return;
    }

    root.dataset.pandaEntrance = "active";
    const bookY = createSpring(-140, 205, 17);
    const pandaY = createSpring(-155, 190, 15);
    const bookCompression = createSpring(0, 260, 18);
    const pandaCompression = createSpring(0, 250, 17);
    const earLeftLag = createSpring(0, 165, 10);
    const earRightLag = createSpring(0, 165, 10);
    const armLeftLag = createSpring(0, 185, 13);
    const armRightLag = createSpring(0, 185, 13);
    const tailLag = createSpring(0, 170, 11);

    let frame = 0;
    const startedAt = performance.now();
    let previousNow = startedAt;
    let bookImpacts = 0;
    let pandaImpacts = 0;
    let pandaImpactAt = Number.POSITIVE_INFINITY;
    let appendagesStarted = false;

    book.style.opacity = "1";
    book.style.transform = "translate3d(0, -140px, 0) scale(1)";
    bookShadow.style.opacity = "0";
    pandaBody.style.opacity = "0";
    pandaBody.style.visibility = "hidden";
    pandaShadow.style.opacity = "0";

    const clearMotionStyles = () => {
      for (const element of [book, bookShadow, pandaBody, pandaShadow, earLeft, earRight, armLeft, armRight, tail]) {
        element.style.removeProperty("opacity");
        element.style.removeProperty("visibility");
        element.style.removeProperty("transform");
        element.style.removeProperty("will-change");
      }
    };

    const settle = () => {
      root.dataset.pandaEntrance = "settled";
      clearMotionStyles();
    };

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const deltaSeconds = Math.max(0, Math.min((now - previousNow) / 1000, 0.032));
      previousNow = now;

      const previousBookY = bookY.value;
      stepSpring(bookY, deltaSeconds);
      if (previousBookY < 0 && bookY.value >= 0 && bookY.velocity > 0 && bookImpacts < 2) {
        bookImpacts += 1;
        const impact = clamp(Math.abs(bookY.velocity) / 1200, 0.035, 0.115);
        bookCompression.value += impact;
        bookCompression.velocity += impact * 4.5;
      }
      stepSpring(bookCompression, deltaSeconds);

      if (elapsed >= PANDA_ENTRANCE_DELAY_MS) {
        pandaBody.style.visibility = "visible";
        pandaBody.style.opacity = "1";
        const previousPandaY = pandaY.value;
        stepSpring(pandaY, deltaSeconds);
        if (previousPandaY < 0 && pandaY.value >= 0 && pandaY.velocity > 0 && pandaImpacts < 2) {
          pandaImpacts += 1;
          const impact = clamp(Math.abs(pandaY.velocity) / 1050, 0.055, 0.145);
          pandaCompression.value += impact;
          pandaCompression.velocity += impact * 4;
          if (pandaImpacts === 1) pandaImpactAt = now;
        }
      }
      stepSpring(pandaCompression, deltaSeconds);

      if (!appendagesStarted && now >= pandaImpactAt + 92) {
        appendagesStarted = true;
        resetSpring(earLeftLag, -20.1, -26);
        resetSpring(earRightLag, 20.1, 26);
        resetSpring(armLeftLag, -8.2, -18);
        resetSpring(armRightLag, 8.2, 18);
        resetSpring(tailLag, 14.5, 22);
      }
      if (appendagesStarted) {
        stepSpring(earLeftLag, deltaSeconds);
        stepSpring(earRightLag, deltaSeconds);
        stepSpring(armLeftLag, deltaSeconds);
        stepSpring(armRightLag, deltaSeconds);
        stepSpring(tailLag, deltaSeconds);
      }

      const bookFallStretch = bookY.value < -6 ? clamp(bookY.velocity / 1800, 0, 0.045) : 0;
      const bookSquash = clamp(bookCompression.value, -0.05, 0.13);
      const bookScaleX = 1 - bookFallStretch * 0.35 + bookSquash * 0.55;
      const bookScaleY = 1 + bookFallStretch - bookSquash;
      const bookNearGround = 1 - clamp(Math.abs(bookY.value) / 140, 0, 1);
      book.style.transform = `translate3d(0, ${bookY.value.toFixed(3)}px, 0) scale(${bookScaleX.toFixed(4)}, ${bookScaleY.toFixed(4)})`;
      bookShadow.style.opacity = String(0.16 + bookNearGround * 0.74);
      bookShadow.style.transform = `scale(${(0.82 + bookNearGround * 0.18 - bookSquash * 0.16).toFixed(4)}, ${(0.88 + bookNearGround * 0.12).toFixed(4)})`;

      if (elapsed >= PANDA_ENTRANCE_DELAY_MS) {
        const pandaFallStretch = pandaY.value < -7 ? clamp(pandaY.velocity / 1600, 0, 0.07) : 0;
        const pandaSquash = clamp(pandaCompression.value, -0.055, 0.155);
        const pandaScaleX = 1 - pandaFallStretch * 0.38 + pandaSquash * 0.58;
        const pandaScaleY = 1 + pandaFallStretch - pandaSquash;
        const pandaNearGround = 1 - clamp(Math.abs(pandaY.value) / 155, 0, 1);
        pandaBody.style.transform = `translate3d(0, ${pandaY.value.toFixed(3)}px, 0) scale(${pandaScaleX.toFixed(4)}, ${pandaScaleY.toFixed(4)})`;
        pandaShadow.style.opacity = String(pandaNearGround * 0.72);
        pandaShadow.style.transform = `scale(${(0.82 + pandaNearGround * 0.18 + pandaSquash * 0.16).toFixed(4)}, ${(0.88 + pandaNearGround * 0.12 - pandaSquash * 0.1).toFixed(4)})`;
      }

      if (appendagesStarted) {
        earLeft.style.transform = `rotate(${earLeftLag.value.toFixed(3)}deg)`;
        earRight.style.transform = `rotate(${earRightLag.value.toFixed(3)}deg)`;
        armLeft.style.transform = `rotate(${armLeftLag.value.toFixed(3)}deg)`;
        armRight.style.transform = `rotate(${armRightLag.value.toFixed(3)}deg)`;
        tail.style.transform = `rotate(${tailLag.value.toFixed(3)}deg)`;
      }

      const bodiesSettled = Math.abs(bookY.value) < 0.35
        && Math.abs(pandaY.value) < 0.35
        && Math.abs(bookY.velocity) < 2.4
        && Math.abs(pandaY.velocity) < 2.4;
      const appendagesSettled = !appendagesStarted
        || (Math.abs(earLeftLag.value) < 0.16 && Math.abs(armLeftLag.value) < 0.12 && Math.abs(tailLag.value) < 0.14);

      if (elapsed > 2300 && bodiesSettled && appendagesSettled) {
        settle();
        return;
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

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

      <span className="pandaWelcomeLabel" aria-hidden="true">panda</span>

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
        <PandaHeroArtwork ref={artworkRef} characterRef={characterRef} />
      </div>
    </div>
  );
}
