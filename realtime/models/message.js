
export default class Message {
    id = null
    message = null
    topic = null

    msg = null
    
    constructor(message){
        this.id = message.id;

        this.message = message.message;

        this.topic = message.topic;

        this.msg = message.msg;
    }

    ack(){
        this.msg?.ack()
    }

    nack(millis){
        this.msg?.nak(millis)
    }
}