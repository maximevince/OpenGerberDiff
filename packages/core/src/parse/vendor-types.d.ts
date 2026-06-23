// Minimal ambient types for the untyped @tracespace v4 packages. We only use the
// streaming factory API; full fidelity lives in our own parsed model.

declare module 'gerber-parser' {
  interface GerberParserStream {
    on(event: 'data', cb: (obj: unknown) => void): this;
    on(event: 'warning', cb: (w: { message: string; line?: number }) => void): this;
    on(event: 'error', cb: (err: Error) => void): this;
    on(event: 'end', cb: () => void): this;
    pipe<T>(dest: T): T;
    write(chunk: string): boolean;
    end(): void;
    format: { units: string | null; nota: string | null };
  }
  interface Options {
    filetype?: 'gerber' | 'drill';
    places?: [number, number];
    zero?: 'L' | 'T';
  }
  function gerberParser(options?: Options): GerberParserStream;
  export = gerberParser;
}

declare module 'gerber-plotter' {
  interface GerberPlotterStream {
    on(event: 'data', cb: (obj: unknown) => void): this;
    on(event: 'warning', cb: (w: { message: string; line?: number }) => void): this;
    on(event: 'error', cb: (err: Error) => void): this;
    on(event: 'end', cb: () => void): this;
    write(chunk: unknown): boolean;
    end(): void;
  }
  function gerberPlotter(options?: Record<string, unknown>): GerberPlotterStream;
  export = gerberPlotter;
}

declare module 'whats-that-gerber' {
  interface LayerType {
    type: string | null;
    side: string | null;
  }
  function whatsThatGerber(filenames: string[]): Record<string, LayerType>;
  export = whatsThatGerber;
}
