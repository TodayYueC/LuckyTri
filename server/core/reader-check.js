import {
  conversationGrounding,
  READABILITY_REQUEST,
} from "./conversation-grounding.js";

export function readerQuestions(snapshot, turn) {
  if (turn.choice === "silent") return [];
  if (snapshot.initiative)
    return snapshot.initiative.expression?.audience?.shared === false
      ? [
          {
            text: "朋友主动发来一个我没参与过的新话题。只看这段话，能知道她具体在聊什么、想表达什么吗？",
            kind: "new_topic",
          },
        ]
      : [];
  const bots = new Set(conversationGrounding(snapshot).botMessageIds);
  const messages = snapshot.messages || [];
  const readability = {
    test: (text) =>
      READABILITY_REQUEST.test(text) ||
      /主要.{0,3}(?:说|讲)|主线.{0,3}(?:什么|啥)|你们.{0,3}(?:干什么|干啥|在聊什么)/.test(
        text,
      ),
  };
  return messages
    .filter(
      (m) =>
        snapshot.batchIds?.includes(m.id) &&
        m.role === "user" &&
        !bots.has(m.id) &&
        (readability.test(m.text || "") ||
          /(?:你们|你俩|你两|一起).{0,15}(?:写|做|拍|搞|试)|(?:怎么不|要不|不如|能不能|为什么不).{0,12}(?:写|做|拍|搞|试)/.test(
            m.text || "",
          ) ||
          (/^[?？]+$/.test((m.text || "").trim()) &&
            messages
              .slice(-15)
              .some(
                (past) =>
                  past.id < m.id &&
                  past.speaker === m.speaker &&
                  readability.test(past.text || "") &&
                  (!m.time || !past.time || m.time - past.time <= 10 * 60000),
              ))),
    )
    .map((m) => ({ id: m.id, name: m.name, text: m.text }));
}

// Someone already immersed in the full history can fill in gaps the actual
// listener cannot. This second, small check intentionally sees only what the
// listener asked and the proposed explanation, not her internal interpretations.
export const READER_CHECK = `检查一段给困惑的聊天参与者的回复。只输出JSON，不扮演聊天人物。
questions是此人想知道或提议的事，reply是他会实际收到的话；只用这些文字判断，不能补造他没听到的背景。对方提议一起写一部新作品时，回复需要考虑这个新提议，不能擅自改成改编正在讨论的旧稿，或拿旧稿的排期、作者许可挡回；只有原话明确要改编旧作时才按改编理解。不要求赞成提议或立刻行动。
“照顾一下我、说听得懂的话”是在请求清楚的交流，不要求回复另列照顾措施、安慰或保证。只问当前在聊什么时，说清讨论对象和内容就够了；只问故事梗概时才核对是否给了情节。没有提供的角色身份与关系不强求补齐，也不能为补齐而编造。
先用普通话概括读者能从reply实际知道什么，再检查是否解答questions。对方要理解具体事情或故事，解释“我们在对稿、记账、互相认下”只说交流形式，仍没有具体内容；“站住、接上、对回去、那半句”没有说明对象时仍听不懂。说“你不用懂”也不是解释。自己确实没读到、没有人物情节可以坦白说不知道，不要求编一个故事。已经说明具体意思的普通短句可以通过，不要求故事完整、知识丰富、风趣或追加提问。
输出 {"ok":true或false,"receivedMeaning":"不补上下文，实际能理解的一句话","issues":["未说清的具体对象/漏答的具体问题，准确引用reply"]}。只挑实质问题，不做润色。`;

export const INTENT_CHECK = `核对另一位机器人是否被当成某人的意思的裁判。humanWords是那个人及其他人的实际原话；claims是机器人解释别人意思的说法；reply是准备发出的回复。
只有本人原话确实支持，才可把claims认定为事实。humanWords只说“当个事办”时，另一人说“他指我的连载”仍是猜测；reply说“原来是这样”并顺着连载开始讨论，就是擅自确认。不能因猜测听来合理或加了一个后续问题而通过。
可以不回应这个猜测，可以等本人说清，可以明确保留不确定后单独聊另一人的作品；这不要求指责或反复提醒对方。检查实际回复，不核查整段历史或评价文风。
输出JSON {"ok":true或false,"issues":["reply如何将未证实解释当成确认，引用原句"]}。`;
