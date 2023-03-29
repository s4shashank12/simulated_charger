FROM denoland/deno:latest as base

WORKDIR /app

COPY . ./

RUN deno cache charger.ts

CMD ["run", "--allow-net", "--allow-env", "charger.ts"]