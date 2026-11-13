import type { HTMLAttributes, ReactNode } from "react";
import { componentClass } from "../componentClass.ts";
import styles from "./Glass.module.css";

type GlassTag = "div" | "aside" | "section" | "header" | "nav";

// Liquid glass surface: distortion, tint and shine layers under a content layer.
export function Glass({
  as: Tag = "div",
  className,
  contentClassName,
  strong = false,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  as?: GlassTag;
  contentClassName?: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <Tag
      {...rest}
      className={`${componentClass(styles, "liquidGlass-wrapper")} ${strong ? componentClass(styles, "strong") : ""} ${className ?? ""}`}
    >
      <div className={componentClass(styles, "liquidGlass-effect")} aria-hidden="true" />
      <div className={componentClass(styles, "liquidGlass-tint")} aria-hidden="true" />
      <div className={componentClass(styles, "liquidGlass-shine")} aria-hidden="true" />
      <div className={`${componentClass(styles, "liquidGlass-text")} ${contentClassName ?? ""}`}>
        {children}
      </div>
    </Tag>
  );
}

// Rendered once by the shell; every glass effect layer references it.
export function GlassFilter() {
  return (
    <svg style={{ display: "none" }} aria-hidden="true">
      <filter id="glass-distortion">
        <feTurbulence type="fractalNoise" baseFrequency="0.01 0.01" numOctaves={1} seed={5} />
        <feGaussianBlur stdDeviation={3} result="softMap" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="softMap"
          scale={150}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
