/// <reference types="vite/client" />

declare namespace JSX {
  interface IntrinsicElements {
    'movi-player': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        src?: string;
        controls?: boolean;
        autoplay?: boolean;
        muted?: boolean;
        resume?: boolean;
        theme?: 'dark' | 'light';
        engine?: string;
        headers?: string;
        persist?: string;
        persistkey?: string;
        title?: string;
      },
      HTMLElement
    >;
  }
}