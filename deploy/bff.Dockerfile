FROM golang:1.23-alpine AS build

WORKDIR /src/upstream/kubeedge-dashboard/modules

ARG TARGETOS=linux
ARG TARGETARCH=amd64

COPY upstream/kubeedge-dashboard/modules/api ./api
COPY upstream/kubeedge-dashboard/modules/common ./common

WORKDIR /src/upstream/kubeedge-dashboard/modules/api
RUN go mod download
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/blueedge-bff ./main.go

FROM alpine:3.21

RUN adduser -D -H -u 10001 blueedge
USER blueedge

COPY --from=build /out/blueedge-bff /usr/local/bin/blueedge-bff

EXPOSE 8080
ENTRYPOINT ["blueedge-bff"]
CMD ["--insecure-bind-address=0.0.0.0", "--insecure-port=8080"]
