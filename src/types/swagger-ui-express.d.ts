declare module 'swagger-ui-express' {
  import { RequestHandler } from 'express';

  declare const serve: RequestHandler[];

  declare function setup(
    swaggerDoc: unknown,
    customOptions?: unknown,
    swaggerOptions?: unknown,
    swaggerCustomCss?: string,
    swaggerCustomJs?: string,
    explorer?: boolean,
  ): RequestHandler;

  declare const swaggerUi: {
    serve: typeof serve;
    setup: typeof setup;
  };

  export { serve, setup };
  export default swaggerUi;
}

