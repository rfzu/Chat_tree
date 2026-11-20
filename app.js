(function () {
  var data = window.DATA;
  var people = data.people;
  var byId = {};
  var traitById = {};
  var bondPerkById = {};
  var palette = ["#2f8f86", "#3d7ec4", "#7b68d6", "#c4843a", "#3f8f6b", "#8a5cab", "#4d7cae", "#b85c6a"];
  people.forEach(function (person, index) {
    byId[person.id] = person;
    person.initials = initials(person.name);
    person.color = palette[index % palette.length];
  });
  data.traits.forEach(function (trait) { traitById[trait.id] = trait; });
  data.bondPerks.forEach(function (perk) { bondPerkById[perk.id] = perk; });

  var POSITIONS_KEY = "govtree-positions-v4";
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(POSITIONS_KEY) || "{}"); } catch (error) { saved = {}; }

  arrange();

  document.getElementById("count").textContent = people.length + " участников";

  var nodes = new vis.DataSet(people.map(function (person) {
    return nodeOptions(person, false);
  }));
  var edges = new vis.DataSet();
  var network = new vis.Network(document.getElementById("graph"), { nodes: nodes, edges: edges }, {
    physics: false,
    interaction: { dragNodes: true, hover: true, multiselect: false, tooltipDelay: 80 },
    nodes: {
      shape: "custom",
      chosen: false,
      ctxRenderer: drawPerson
    },
    edges: {
      arrows: { to: { enabled: true, scaleFactor: 0.55 } },
      smooth: { type: "curvedCW", roundness: 0.18 },
      font: { color: "#f4f7fb", size: 12, strokeWidth: 4, strokeColor: "#0b1220", face: "Segoe UI" }
    }
  });
  network.fit({ animation: false });

  var selectedId = null;
  var view = { type: "empty" };
  var edgeFilter = "all";
  var relationTab = "out";
  var showTraits = document.getElementById("show-traits");
  var showWeak = document.getElementById("show-weak");

  network.on("click", function (params) {
    if (!params.nodes.length) return;
    choose(params.nodes[0], false);
  });
  network.on("dragEnd", function (params) {
    if (!params.nodes.length) return;
    var positions = network.getPositions(params.nodes);
    params.nodes.forEach(function (id) {
      saved[id] = { x: positions[id].x, y: positions[id].y };
      byId[id].x = positions[id].x;
      byId[id].y = positions[id].y;
    });
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(saved));
  });
  network.on("zoom", updateZoomLabel);

  document.getElementById("card").addEventListener("click", onCardClick);
  document.querySelectorAll(".pill").forEach(function (button) {
    button.addEventListener("click", function () {
      edgeFilter = button.getAttribute("data-filter");
      document.querySelectorAll(".pill").forEach(function (item) { item.classList.toggle("on", item === button); });
      paintEdges();
      paint();
    });
  });
  document.getElementById("filters-btn").addEventListener("click", function () {
    var menu = document.getElementById("filters-menu");
    menu.hidden = !menu.hidden;
    this.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
  });
  showTraits.addEventListener("change", paintEdges);
  showWeak.addEventListener("change", paintEdges);
  document.getElementById("zoom-in").addEventListener("click", function () { zoomBy(1.2); });
  document.getElementById("zoom-out").addEventListener("click", function () { zoomBy(1 / 1.2); });
  document.getElementById("zoom-fit").addEventListener("click", function () {
    network.fit({ animation: { duration: 180 } });
  });
  document.getElementById("search").addEventListener("input", onSearch);
  document.getElementById("search-results").addEventListener("click", function (event) {
    var button = event.target.closest("[data-person]");
    if (!button) return;
    choose(button.getAttribute("data-person"), true);
    document.getElementById("search").value = "";
    document.getElementById("search-results").hidden = true;
  });

  paintEdges();
  paint();
  updateZoomLabel();
  loadPhotos();

  function choose(id, focus) {
    selectedId = id;
    view = { type: "person", id: id };
    relationTab = "out";
    paintSelection();
    paintEdges();
    network.selectNodes([id]);
    if (focus) network.focus(id, { scale: 1.15, animation: { duration: 180 } });
    paint();
  }

  function hasTrait(person, traitId) {
    if (person.traits.indexOf(traitId) !== -1) return true;
    return traitId === "gym" && person.traits.indexOf("gym-boss") !== -1;
  }

  function visibleTraits(person) {
    var ids = person.traits.slice();
    if (hasTrait(person, "gym") && ids.indexOf("gym") === -1) ids.splice(ids.indexOf("gym-boss") + 1, 0, "gym");
    return ids;
  }

  function contributions(fromId, toId) {
    if (fromId === toId) return [];
    var list = [];
    var viewer = byId[fromId];
    var subject = byId[toId];
    data.traitRules.forEach(function (rule) {
      var viewerHas = hasTrait(viewer, rule.from);
      if (rule.fromLacks ? viewerHas : !viewerHas) return;
      var fromAlso = rule.fromAlso ? [].concat(rule.fromAlso) : [];
      if (fromAlso.some(function (traitId) { return !hasTrait(viewer, traitId); })) return;
      if (!rule.toAll) {
        var subjectHas = hasTrait(subject, rule.to);
        if (rule.lacks ? subjectHas : !subjectHas) return;
        if (rule.alsoHas && !hasTrait(subject, rule.alsoHas)) return;
        var lacks = rule.alsoLacks ? [].concat(rule.alsoLacks) : [];
        if (lacks.some(function (traitId) { return hasTrait(subject, traitId); })) return;
      }
      list.push({ score: rule.score, reason: rule.reason, kind: "trait" });
    });
    data.pairs.forEach(function (pair) {
      if (pair.from === fromId && pair.to === toId) list.push({ score: pair.score, reason: pair.reason, kind: "pair" });
    });
    data.bonds.forEach(function (bond) {
      var match = (bond.a === fromId && bond.b === toId) || (bond.b === fromId && bond.a === toId);
      if (!match) return;
      list.push({ score: bondPerkById[bond.perkId].score, reason: bondPerkById[bond.perkId].label, kind: "bond" });
    });
    (data.notes || []).forEach(function (note) {
      var directed = note.from && note.to;
      var match = directed ? note.from === fromId && note.to === toId : (note.a === fromId && note.b === toId) || (note.b === fromId && note.a === toId);
      if (!match || !note.score) return;
      list.push({ score: note.score, reason: note.text, kind: "pair" });
    });
    return list;
  }

  function relation(fromId, toId) {
    var parts = contributions(fromId, toId);
    var raw = parts.reduce(function (sum, part) { return sum + part.score; }, 0);
    return { parts: parts, raw: raw, level: parts.length ? clamp(raw) : 0 };
  }

  function clamp(value) { return Math.max(-5, Math.min(5, value)); }

  function nodeSize(person) {
    var maxWeight = 0;
    people.forEach(function (item) { maxWeight = Math.max(maxWeight, weight(item)); });
    if (!maxWeight) return 16;
    return Math.round(14 + (weight(person) / maxWeight) * 32);
  }

  function strongCount(person) {
    if (person._strong != null) return person._strong;
    var count = 0;
    people.forEach(function (other) {
      if (other.id === person.id) return;
      var out = relation(person.id, other.id).level;
      var back = relation(other.id, person.id).level;
      if (Math.abs(out) >= 3 || Math.abs(back) >= 3) count += 1;
    });
    person._strong = count;
    return count;
  }

  function weight(person) {
    return visibleTraits(person).length + strongCount(person);
  }

  function arrange() {
    var maxWeight = 0;
    people.forEach(function (person) { maxWeight = Math.max(maxWeight, weight(person)); });
    var bands = [[], [], [], [], [], []];
    people.forEach(function (person) {
      var score = weight(person);
      var band = !score || !maxWeight ? 0 : 1 + Math.min(4, Math.floor(((score - 1) / maxWeight) * 5));
      bands[band].push(person);
    });
    var y = 0;
    var placed = false;
    for (var band = bands.length - 1; band >= 0; band -= 1) {
      var group = bands[band].sort(function (a, b) {
        return weight(b) - weight(a) || a.name.localeCompare(b.name, "ru");
      });
      if (!group.length) continue;
      if (placed && band === 0) y += 160;
      placed = true;
      var perRow = band === 0 ? 12 : 8;
      for (var start = 0; start < group.length; start += perRow) {
        var row = group.slice(start, start + perRow);
        var gapX = 168;
        row.forEach(function (person, index) {
          var stored = saved[person.id];
          if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
            person.x = stored.x;
            person.y = stored.y;
            return;
          }
          person.x = (index - (row.length - 1) / 2) * gapX;
          person.y = y;
        });
        y += 210;
      }
    }
  }

  function nodeOptions(person, selected) {
    return {
      id: person.id,
      label: person.initials,
      title: person.name,
      x: person.x,
      y: person.y,
      size: selected ? Math.round(nodeSize(person) * 1.2) : nodeSize(person),
      color: { background: selected ? "#e39a3a" : person.color, border: "transparent" },
      font: { color: "#ffffff", size: selected ? 16 : 12 },
      opacity: selectedId && !selected ? 0.55 : 1
    };
  }

  function drawPerson(props) {
    var ctx = props.ctx;
    var radius = props.style.size || 18;
    var selected = props.state.selected || (selectedId && props.id === selectedId);
    var person = byId[props.id];
    return {
      drawNode: function () {
        if (selected) {
          ctx.shadowColor = "rgba(227, 154, 58, 0.85)";
          ctx.shadowBlur = 28;
        }
        ctx.beginPath();
        ctx.arc(props.x, props.y, radius, 0, Math.PI * 2);
        ctx.closePath();
        if (person._image) {
          ctx.save();
          ctx.clip();
          var iw = person._image.width;
          var ih = person._image.height;
          var scale = Math.max((radius * 2) / iw, (radius * 2) / ih);
          var w = iw * scale;
          var h = ih * scale;
          ctx.drawImage(person._image, props.x - w / 2, props.y - h / 2, w, h);
          ctx.restore();
        } else {
          ctx.fillStyle = selected ? "#e39a3a" : person.color;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#ffffff";
          ctx.font = (selected ? "700 " : "600 ") + Math.max(11, Math.round(radius * 0.5)) + "px Segoe UI";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(person.initials, props.x, props.y);
        }
        if (selected) {
          ctx.shadowBlur = 0;
          ctx.lineWidth = 3;
          ctx.strokeStyle = "#e39a3a";
          ctx.stroke();
        }
      },
      drawExternalLabel: function () {
        ctx.font = "12px Segoe UI";
        ctx.fillStyle = selected ? "#ffffff" : "rgba(231,238,248,0.82)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(shortName(person.name), props.x, props.y + radius + 6);
      },
      nodeDimensions: { width: radius * 2, height: radius * 2 }
    };
  }

  function kindOf(level) {
    if (level >= 3) return "friend";
    if (level > 0) return "like";
    return "conflict";
  }

  function passes(level) {
    if (level === 0) return false;
    if (edgeFilter === "friend") return level >= 3;
    if (edgeFilter === "like") return level > 0 && level < 3;
    if (edgeFilter === "conflict") return level < 0;
    return true;
  }

  function edgeColor(level) {
    var kind = kindOf(level);
    if (kind === "friend") return "#3dde9a";
    if (kind === "like") return "#9b7bff";
    return "#ff8d42";
  }

  function structural(parts) {
    return parts.some(function (part) { return part.kind === "pair" || part.kind === "bond"; });
  }

  function paintEdges() {
    var next = [];
    people.forEach(function (from) {
      people.forEach(function (to) {
        var rel = relation(from.id, to.id);
        if (!passes(rel.level)) return;
        var strong = Math.abs(rel.level) >= 3;
        if (!strong && !showWeak.checked) return;
        var touches = selectedId && (from.id === selectedId || to.id === selectedId);
        var solid = structural(rel.parts);
        if (!strong && !touches && !solid && !showTraits.checked) return;
        var color = edgeColor(rel.level);
        next.push({
          id: from.id + ">" + to.id,
          from: from.id,
          to: to.id,
          width: strong ? (touches ? 5 : 3.6) : (touches ? 1.3 : 0.7),
          color: { color: color, highlight: color, hover: color, opacity: touches || !selectedId ? 1 : 0.18 },
          label: touches && (Math.abs(rel.level) >= 2 || edgeFilter !== "all") ? signed(rel.level) : "",
          title: from.name + " → " + to.name + ": " + signed(rel.level)
        });
      });
    });
    edges.clear();
    edges.add(next);
  }

  function paintSelection() {
    nodes.update(people.map(function (person) { return nodeOptions(person, person.id === selectedId); }));
  }

  function paint() {
    var card = document.getElementById("card");
    card.replaceChildren();
    if (view.type === "trait") paintTrait(card, traitById[view.id]);
    else if (view.type === "bond") paintBondPerk(card, bondPerkById[view.id]);
    else if (view.type === "person") paintPerson(card, byId[view.id]);
    else paintEmpty(card);
  }

  function paintEmpty(card) {
    var box = document.createElement("div");
    box.className = "empty-panel";
    box.textContent = "Выберите человека на карте, чтобы увидеть профиль и оценки.";
    card.appendChild(box);
  }

  function paintPerson(card, person) {
    var top = document.createElement("div");
    top.className = "panel-top";
    top.textContent = "ПРОФИЛЬ УЧАСТНИКА";
    var close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn";
    close.setAttribute("data-close", "1");
    close.setAttribute("aria-label", "Закрыть");
    close.textContent = "×";
    top.appendChild(close);
    card.appendChild(top);

    var head = document.createElement("div");
    head.className = "profile-head";
    var avatar = document.createElement("div");
    avatar.className = "avatar";
    paintFace(avatar, person, false);
    var titles = document.createElement("div");
    var name = document.createElement("h2");
    name.textContent = person.name;
    var meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = "Участник #" + person.number + (person.aliases && person.aliases.length ? " · " + person.aliases.join(", ") : "");
    titles.appendChild(name);
    titles.appendChild(meta);
    head.appendChild(avatar);
    head.appendChild(titles);
    card.appendChild(head);

    var traits = document.createElement("div");
    traits.className = "block";
    var traitTitle = document.createElement("h3");
    traitTitle.textContent = "Особенности";
    traits.appendChild(traitTitle);
    var chips = document.createElement("div");
    chips.className = "chips";
    var shownTraits = visibleTraits(person);
    if (!shownTraits.length) addText(chips, "Пока не добавлены", "empty");
    shownTraits.forEach(function (traitId) {
      chips.appendChild(chip(traitById[traitId].label, { "data-trait": traitId }));
    });
    traits.appendChild(chips);
    card.appendChild(traits);

    var skills = document.createElement("div");
    skills.className = "block";
    var skillTitle = document.createElement("h3");
    skillTitle.textContent = "Скиллы";
    skills.appendChild(skillTitle);
    addText(skills, person.skills.length ? person.skills.join(", ") : "Пока не добавлены", person.skills.length ? "" : "empty");
    card.appendChild(skills);

    var bonds = data.bonds.filter(function (bond) { return bond.a === person.id || bond.b === person.id; });
    var notes = (data.notes || []).filter(function (note) { return note.a === person.id || note.b === person.id || note.person === person.id; });
    if (bonds.length || notes.length) {
      var bondBlock = document.createElement("div");
      bondBlock.className = "block";
      var bondTitle = document.createElement("h3");
      bondTitle.textContent = "Отношения";
      bondBlock.appendChild(bondTitle);
      bonds.forEach(function (bond) {
        var otherId = bond.a === person.id ? bond.b : bond.a;
        var row = document.createElement("p");
        row.appendChild(personButton(otherId));
        row.appendChild(document.createTextNode(" — "));
        var button = document.createElement("button");
        button.type = "button";
        button.className = "link";
        button.setAttribute("data-bond", bond.perkId);
        button.textContent = bondPerkById[bond.perkId].label;
        row.appendChild(button);
        bondBlock.appendChild(row);
      });
      notes.forEach(function (note) {
        var otherId = note.other || (note.a === person.id ? note.b : note.a);
        var row = document.createElement("p");
        row.appendChild(personButton(otherId));
        row.appendChild(document.createTextNode(" — " + note.text));
        bondBlock.appendChild(row);
      });
      card.appendChild(bondBlock);
    }

    var tabs = document.createElement("div");
    tabs.className = "tabs";
    tabs.appendChild(tabButton("Как видит", "out"));
    tabs.appendChild(tabButton("Кто как видит", "in"));
    card.appendChild(tabs);
    var list = document.createElement("div");
    list.className = "rel-list";
    paintRelations(list, person, relationTab === "out");
    card.appendChild(list);
  }

  function tabButton(text, id) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.setAttribute("data-tab", id);
    if (relationTab === id) button.className = "on";
    return button;
  }

  function paintRelations(card, person, outward) {
    var rows = [];
    people.forEach(function (other) {
      if (other.id === person.id) return;
      var rel = outward ? relation(person.id, other.id) : relation(other.id, person.id);
      if (!passes(rel.level)) return;
      rows.push({ other: other, rel: rel });
    });
    rows.sort(function (a, b) { return Math.abs(b.rel.level) - Math.abs(a.rel.level) || a.other.name.localeCompare(b.other.name, "ru"); });
    if (!rows.length) {
      addText(card, "В этом фильтре оценок нет.", "empty");
      return;
    }
    rows.forEach(function (row) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "rel";
      button.setAttribute("data-person", row.other.id);
      var mini = document.createElement("span");
      mini.className = "mini";
      paintFace(mini, row.other, true);
      var text = document.createElement("span");
      var name = document.createElement("b");
      name.textContent = row.other.name;
      var kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = kindLabel(row.rel.level);
      var reasons = document.createElement("small");
      reasons.textContent = row.rel.parts.map(function (part) { return part.reason + " " + signed(part.score); }).join(" · ");
      text.appendChild(name);
      text.appendChild(kind);
      text.appendChild(reasons);
      var score = document.createElement("span");
      score.className = "score " + kindOf(row.rel.level);
      score.textContent = signed(row.rel.level);
      button.appendChild(mini);
      button.appendChild(text);
      button.appendChild(score);
      card.appendChild(button);
    });
  }

  function paintTrait(card, trait) {
    card.appendChild(backButton());
    addHeading(card, trait.label);
    addText(card, trait.text);
    addHeading(card, "Как влияет");
    var rules = data.traitRules.filter(function (rule) {
      var fromAlso = rule.fromAlso ? [].concat(rule.fromAlso) : [];
      return rule.from === trait.id || rule.to === trait.id || fromAlso.indexOf(trait.id) !== -1 || rule.toAll && rule.from === trait.id;
    });
    if (!rules.length) addText(card, "На репутацию черта пока не влияет.", "empty");
    rules.forEach(function (rule) { addText(card, ruleSentence(trait, rule)); });
    addHeading(card, "У кого есть");
    var owners = people.filter(function (person) { return hasTrait(person, trait.id); });
    if (!owners.length) addText(card, "Ни у кого.", "empty");
    owners.forEach(function (person) {
      var row = document.createElement("p");
      row.appendChild(personButton(person.id));
      card.appendChild(row);
    });
  }

  function paintBondPerk(card, perk) {
    card.appendChild(backButton());
    addHeading(card, perk.label);
    addText(card, perk.text);
    addHeading(card, "Как влияет");
    addText(card, "В обе стороны " + signed(perk.score) + ".");
    addHeading(card, "Пары");
    data.bonds.filter(function (bond) { return bond.perkId === perk.id; }).forEach(function (bond) {
      var row = document.createElement("p");
      row.appendChild(personButton(bond.a));
      row.appendChild(document.createTextNode(" и "));
      row.appendChild(personButton(bond.b));
      card.appendChild(row);
    });
  }

  function backButton() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "link back";
    button.setAttribute("data-back", "1");
    button.textContent = "К человеку";
    return button;
  }

  function traitLabel(id) {
    return traitById[id] ? traitById[id].label : id;
  }

  function ruleSentence(trait, rule) {
    var otherId = rule.from === trait.id ? rule.to : rule.from;
    var other = traitLabel(otherId);
    if (rule.toAll) return "Оценивает каждого другого человека на " + signed(rule.score) + ".";
    if (rule.fromAlso) {
      var viewers = [rule.from].concat([].concat(rule.fromAlso));
      var viewerText = viewers.map(function (id) { return "«" + traitLabel(id) + "»"; }).join(" и ");
      var target = rule.to === trait.id ? "носителя этой черты" : "носителя черты «" + traitLabel(rule.to) + "»";
      return "Носитель черт " + viewerText + " оценивает " + target + " на " + signed(rule.score) + ".";
    }
    if (rule.from === rule.to) return "Носители оценивают друг друга на " + signed(rule.score) + ".";
    if (rule.fromLacks) return "Тот, у кого нет черты «" + traitLabel(rule.from) + "», оценивает носителя черты «" + traitLabel(rule.to) + "» на " + signed(rule.score) + ".";
    if (rule.lacks) return "Носитель черты «" + traitLabel(rule.from) + "» оценивает того, у кого нет черты «" + other + "», на " + signed(rule.score) + ".";
    var conditions = [];
    if (rule.alsoHas) conditions.push("есть " + [].concat(rule.alsoHas).map(function (id) { return "«" + traitLabel(id) + "»"; }).join(" и "));
    if (rule.alsoLacks) conditions.push("нет " + [].concat(rule.alsoLacks).map(function (id) { return "«" + traitLabel(id) + "»"; }).join(" и "));
    var extra = conditions.length ? ", если у него " + conditions.join(" и ") + "," : "";
    if (rule.from === trait.id) return "Оценивает носителя черты «" + other + "»" + extra + " на " + signed(rule.score) + ".";
    return "Носитель черты «" + traitLabel(rule.from) + "» оценивает носителя этой черты" + extra + " на " + signed(rule.score) + ".";
  }

  function onCardClick(event) {
    if (event.target.closest("[data-close]")) {
      selectedId = null;
      view = { type: "empty" };
      network.unselectAll();
      paintSelection();
      paintEdges();
      paint();
      return;
    }
    var tab = event.target.closest("[data-tab]");
    if (tab) {
      relationTab = tab.getAttribute("data-tab");
      paint();
      return;
    }
    var traitButton = event.target.closest("[data-trait]");
    if (traitButton) {
      view = { type: "trait", id: traitButton.getAttribute("data-trait") };
      paint();
      return;
    }
    var bondButton = event.target.closest("[data-bond]");
    if (bondButton) {
      view = { type: "bond", id: bondButton.getAttribute("data-bond") };
      paint();
      return;
    }
    var personBtn = event.target.closest("[data-person]");
    if (personBtn) {
      choose(personBtn.getAttribute("data-person"), true);
      return;
    }
    if (event.target.closest("[data-back]") && selectedId) {
      view = { type: "person", id: selectedId };
      paint();
    }
  }

  function onSearch() {
    var query = document.getElementById("search").value.trim().toLowerCase();
    var box = document.getElementById("search-results");
    box.replaceChildren();
    if (!query) { box.hidden = true; return; }
    people.filter(function (person) {
      if (person.name.toLowerCase().indexOf(query) !== -1) return true;
      return (person.aliases || []).some(function (alias) { return alias.toLowerCase().indexOf(query) !== -1; });
    }).slice(0, 8).forEach(function (person) {
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-person", person.id);
      button.textContent = person.name;
      box.appendChild(button);
    });
    box.hidden = !box.childElementCount;
  }

  function personButton(id) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "link";
    button.setAttribute("data-person", id);
    button.textContent = byId[id].name;
    return button;
  }

  function chip(text, attrs) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    Object.keys(attrs).forEach(function (key) { button.setAttribute(key, attrs[key]); });
    button.textContent = text;
    return button;
  }

  function addHeading(parent, text) {
    var heading = document.createElement("h2");
    heading.textContent = text;
    heading.style.padding = "16px 18px 0";
    parent.appendChild(heading);
  }

  function addText(parent, text, className) {
    var row = document.createElement("p");
    if (className) row.className = className;
    row.style.padding = "0 18px";
    row.textContent = text;
    parent.appendChild(row);
  }

  function paintFace(el, person, useColor) {
    if (person.photo) {
      el.textContent = "";
      el.style.backgroundImage = "url(\"" + person.photo + "\")";
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
      return;
    }
    if (useColor) el.style.background = person.color;
    el.textContent = person.initials;
  }

  function loadPhotos() {
    people.forEach(function (person) {
      if (!person.photo) return;
      var image = new Image();
      image.onload = function () {
        person._image = image;
        network.redraw();
      };
      image.src = person.photo;
    });
  }

  function initials(name) {
    var clean = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
    var parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0] || name).slice(0, 2).toUpperCase();
  }

  function shortName(name) {
    return name.length > 18 ? name.slice(0, 16) + "…" : name;
  }

  function kindLabel(level) {
    var named = scaleName(level);
    if (named) return named.charAt(0).toUpperCase() + named.slice(1);
    if (level > 0) return "Симпатия";
    return "Конфликт";
  }

  function signed(value) {
    if (value > 0) return "+" + String(value);
    return String(value).replace("-", "−");
  }

  function scaleName(value) {
    if (value === 5) return "любовь";
    if (value === 4 || value === 3) return "дружба";
    if (value === 0) return "нейтралитет";
    if (value === -4 || value === -3) return "неприязнь";
    if (value === -5) return "враги";
    return "";
  }

  function zoomBy(factor) {
    var scale = network.getScale() * factor;
    network.moveTo({ scale: Math.min(2.4, Math.max(0.15, scale)), animation: { duration: 140 } });
  }

  function updateZoomLabel() {
    document.getElementById("zoom-label").textContent = Math.round(network.getScale() * 100) + "%";
  }
}());
