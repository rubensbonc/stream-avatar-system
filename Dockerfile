FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev \
    build-base \
    g++ \
    python3

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/uploads /app/public/assets/cosmetics

EXPOSE 3000

CMD ["node", "src/index.js"]
