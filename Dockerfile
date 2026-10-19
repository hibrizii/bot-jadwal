FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy project files
COPY . .

# Expose port untuk web controller & health check
EXPOSE 3000

ENV PORT=3000

CMD ["node", "index.js"]
