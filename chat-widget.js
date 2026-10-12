(function () {
  var script = document.currentScript;
  var ENDPOINT = script.getAttribute("data-endpoint");
  var MODEL = script.getAttribute("data-model") || undefined;
  var AVATAR = script.getAttribute("data-avatar") || "/logo-movex.png";
  var GREETING = "Xin chào! Tôi là trợ lý Movex. Bạn cần tư vấn gì về bột tẩy lồng máy giặt?";
  var history = [];
  var busy = false;

  var root = document.createElement("div");
  root.className = "mx-chat";
  root.innerHTML =
    '<button class="mx-chat-toggle" type="button" aria-expanded="false" aria-controls="mx-chat-panel" aria-label="Mở trợ lý Movex">' +
    '<img src="' + AVATAR + '" alt=""><span class="mx-chat-badge">Hỏi Movex</span></button>' +
    '<section class="mx-chat-panel" id="mx-chat-panel" hidden aria-label="Trợ lý Movex">' +
    '<header class="mx-chat-head"><img class="mx-chat-avatar" src="' + AVATAR + '" alt="">' +
    '<div><strong>Trợ lý Movex</strong><small>Thường trả lời trong vài giây</small></div>' +
    '<button class="mx-chat-close" type="button" aria-label="Đóng">×</button></header>' +
    '<div class="mx-chat-log" role="log" aria-live="polite"></div>' +
    '<form class="mx-chat-form">' +
    '<textarea rows="1" maxlength="2000" placeholder="Nhập câu hỏi…" aria-label="Câu hỏi"></textarea>' +
    '<button type="submit">Gửi</button></form>' +
    '<p class="mx-chat-note">Trợ lý AI có thể nhầm lẫn. Thông tin chính thức xem trên bao bì sản phẩm.</p>' +
    "</section>";
  document.body.appendChild(root);

  var toggle = root.querySelector(".mx-chat-toggle");
  var panel = root.querySelector(".mx-chat-panel");
  var log = root.querySelector(".mx-chat-log");
  var form = root.querySelector(".mx-chat-form");
  var input = form.querySelector("textarea");
  var sendBtn = form.querySelector("button");

  function addBubble(role, text) {
    var el = document.createElement("div");
    el.className = "mx-msg mx-msg-" + role;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      if (!log.childElementCount) addBubble("assistant", GREETING);
      input.focus();
    }
  }

  toggle.addEventListener("click", function () { setOpen(panel.hidden); });
  root.querySelector(".mx-chat-close").addEventListener("click", function () { setOpen(false); });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    ask(text);
  });

  async function ask(text) {
    busy = true;
    sendBtn.disabled = true;
    addBubble("user", text);
    history.push({ role: "user", content: text });
    var bubble = addBubble("assistant", "…");
    var answer = "";
    var failed = false;

    try {
      var res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, model: MODEL }),
      });
      if (!res.ok || !res.body) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.error || "Không kết nối được trợ lý.");
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var events = buffer.split("\n\n");
        buffer = events.pop();
        for (var i = 0; i < events.length; i++) {
          if (events[i].indexOf("data: ") !== 0) continue;
          var data = JSON.parse(events[i].slice(6));
          if (data.text) {
            answer += data.text;
            bubble.textContent = answer.replace(/\*\*/g, "");
            log.scrollTop = log.scrollHeight;
          } else if (data.error) {
            throw new Error(data.error);
          }
        }
      }
      if (!answer) throw new Error("Trợ lý không trả lời, vui lòng thử lại.");
    } catch (e) {
      failed = true;
      bubble.textContent = answer ? answer + "\n\n⚠ " + e.message : e.message;
      bubble.classList.add("mx-msg-error");
    }

    if (failed && !answer) {
      history.pop(); // drop the unanswered question so the next turn stays valid
    } else {
      history.push({ role: "assistant", content: answer.replace(/\*\*/g, "") });
    }
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
})();
