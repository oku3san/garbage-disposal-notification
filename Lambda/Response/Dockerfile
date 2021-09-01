FROM node AS build
WORKDIR /app
COPY index.ts package.json tsconfig.json ./
RUN npm install --only=dev && \
  npm run build

FROM amazon/aws-lambda-nodejs:14
RUN yum install -y unzip
COPY package*.json layer/newrelic.zip ./
COPY --from=build /app/index.js ./
RUN npm install

RUN mkdir -p /opt && \
  unzip newrelic.zip -d /opt && \
  rm newrelic.zip

CMD [ "newrelic-lambda-wrapper.handler" ]
