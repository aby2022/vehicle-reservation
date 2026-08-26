# 轻量镜像：基于 alpine，体积小、启动快
FROM node:18-alpine
WORKDIR /app
COPY package.json ./
# 零依赖，无需 npm install；如以后增加依赖可取消下一行注释
# RUN npm install --production
COPY server.js ./
COPY public ./public
COPY data ./data
RUN mkdir -p /app/data
EXPOSE 3000
ENV HOST=0.0.0.0
ENV PORT=3000
CMD ["node", "server.js"]
