FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy project files
COPY . .

# Set permissions for non-root user (Hugging Face Spaces UID 1000)
RUN chown -R node:node /app
USER node

# Expose port (Default Hugging Face 7860, standard fallback 3000)
ENV PORT=7860
EXPOSE 7860

CMD ["node", "index.js"]
