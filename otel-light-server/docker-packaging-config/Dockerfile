FROM node:alpine

COPY files /opt/app
COPY start-cmd.sh /start-cmd.sh

RUN apk --update add bash && \
    chmod +x /*.sh

CMD ["/start-cmd.sh"]
