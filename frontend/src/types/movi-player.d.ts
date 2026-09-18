import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'movi-player': DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string;
          controls?: boolean;
          autoplay?: boolean;
          muted?: boolean;
          loop?: boolean;
          poster?: string;
          preload?: 'none' | 'metadata' | 'auto';
          resume?: boolean;
          theme?: 'dark' | 'light';
          title?: string;
          persist?: string;
          persistkey?: string;
          engine?: string;
          headers?: string;
          ambient?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};