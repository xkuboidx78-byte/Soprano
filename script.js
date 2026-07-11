// Otwarcie kurtyny przy załadowaniu strony
window.addEventListener("load", () => {
    requestAnimationFrame(() => {
        setTimeout(() => document.body.classList.add("curtains-open"), 250);
    });
});

// Mobilne menu (hamburger)
const navToggle = document.querySelector(".nav-toggle");
const nav = document.querySelector("nav");
navToggle?.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("active");
    navToggle.classList.toggle("active");
    navToggle.setAttribute("aria-expanded", String(isOpen));
});

// Zamknij menu mobilne po kliknięciu w link
nav?.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
        nav.classList.remove("active");
        navToggle?.classList.remove("active");
        navToggle?.setAttribute("aria-expanded", "false");
    });
});

// Przycisk rezerwacji sesji
document.querySelector("#buyBtn")?.addEventListener("click", () => {
    alert("System rezerwacji wkrótce 🔥");
});

// Płynne pojawianie się sekcji przy scrollowaniu
const revealEls = document.querySelectorAll(".section");
revealEls.forEach(el => el.classList.add("reveal"));

if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("visible");
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15 });
    revealEls.forEach(el => observer.observe(el));
} else {
    // Fallback dla starszych przeglądarek
    revealEls.forEach(el => el.classList.add("visible"));
}

/* ---------- Hierarchia Rodziny ---------- */
(() => {
    const EDIT_PASSWORD = "soprano"; // porównanie bez uwzględniania wielkości liter

    // Rangi od najwyższej do najniższej + skład startowy — podmień pod swoją rodzinę
    const ranks = [
        { id: "boss", label: "Boss", members: ["Tony"] },
        { id: "underboss", label: "Underboss", members: ["Silvio"] },
        { id: "consigliere", label: "Consigliere", members: [] },
        { id: "capo", label: "Capo", members: ["Paulie", "Christopher"] },
        { id: "soldier", label: "Żołnierz", members: [] },
        { id: "recruit", label: "Rekrut", members: [] },
    ];

    const board = document.getElementById("hierarchyBoard");
    const editToggle = document.getElementById("editToggle");
    const addBar = document.getElementById("addMemberBar");
    const newNameInput = document.getElementById("newMemberName");
    const newRankSelect = document.getElementById("newMemberRank");
    const addBtn = document.getElementById("addMemberBtn");

    if (!board) return;

    let editMode = false;

    function findRank(id){ return ranks.find(r => r.id === id); }

    function render(){
        board.innerHTML = "";
        board.classList.toggle("edit-mode", editMode);

        ranks.forEach(rank => {
            const col = document.createElement("div");
            col.className = "rank-column";
            col.dataset.rankId = rank.id;

            const h3 = document.createElement("h3");
            h3.textContent = rank.label;
            col.appendChild(h3);

            const count = document.createElement("span");
            count.className = "rank-count";
            count.textContent = rank.members.length + (rank.members.length === 1 ? " osoba" : " osób");
            col.appendChild(count);

            const list = document.createElement("div");
            list.className = "rank-list";

            if (rank.members.length === 0){
                const empty = document.createElement("span");
                empty.className = "rank-empty";
                empty.textContent = "— puste —";
                list.appendChild(empty);
            }

            rank.members.forEach(name => {
                const chip = document.createElement("div");
                chip.className = "member-chip";
                chip.draggable = editMode;
                chip.dataset.name = name;

                const nameSpan = document.createElement("span");
                nameSpan.textContent = name;
                chip.appendChild(nameSpan);

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "remove-member";
                removeBtn.setAttribute("aria-label", `Usuń ${name}`);
                removeBtn.textContent = "×";
                removeBtn.addEventListener("click", () => {
                    rank.members = rank.members.filter(m => m !== name);
                    render();
                });
                chip.appendChild(removeBtn);

                chip.addEventListener("dragstart", (e) => {
                    if (!editMode) return;
                    e.dataTransfer.setData("text/plain", JSON.stringify({ name, from: rank.id }));
                    chip.classList.add("dragging");
                });
                chip.addEventListener("dragend", () => chip.classList.remove("dragging"));

                list.appendChild(chip);
            });

            col.appendChild(list);

            col.addEventListener("dragover", (e) => {
                if (!editMode) return;
                e.preventDefault();
                col.classList.add("drag-over");
            });
            col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
            col.addEventListener("drop", (e) => {
                if (!editMode) return;
                e.preventDefault();
                col.classList.remove("drag-over");
                let data;
                try { data = JSON.parse(e.dataTransfer.getData("text/plain")); }
                catch { return; }
                const { name, from } = data;
                if (from === rank.id) return;
                const fromRank = findRank(from);
                if (fromRank) fromRank.members = fromRank.members.filter(m => m !== name);
                rank.members.push(name);
                render();
            });

            board.appendChild(col);
        });

        // odśwież listę rang w formularzu dodawania
        newRankSelect.innerHTML = "";
        ranks.forEach(rank => {
            const opt = document.createElement("option");
            opt.value = rank.id;
            opt.textContent = rank.label;
            newRankSelect.appendChild(opt);
        });
    }

    editToggle.addEventListener("click", () => {
        if (editMode){
            editMode = false;
            editToggle.classList.remove("active");
            editToggle.setAttribute("aria-pressed", "false");
            editToggle.querySelector(".edit-toggle-label").textContent = "Edytuj hierarchię";
            editToggle.querySelector(".lock-icon").textContent = "🔒";
            addBar.hidden = true;
            render();
            return;
        }
        const input = window.prompt("Podaj hasło, aby edytować hierarchię:");
        if (input === null) return;
        if (input.trim().toLowerCase() === EDIT_PASSWORD){
            editMode = true;
            editToggle.classList.add("active");
            editToggle.setAttribute("aria-pressed", "true");
            editToggle.querySelector(".edit-toggle-label").textContent = "Zakończ edycję";
            editToggle.querySelector(".lock-icon").textContent = "🔓";
            addBar.hidden = false;
            render();
        } else {
            alert("Błędne hasło.");
        }
    });

    addBtn.addEventListener("click", () => {
        const name = newNameInput.value.trim();
        if (!name) return;
        const rank = findRank(newRankSelect.value) || ranks[ranks.length - 1];
        rank.members.push(name);
        newNameInput.value = "";
        render();
        newNameInput.focus();
    });

    newNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addBtn.click();
    });

    render();
})();
