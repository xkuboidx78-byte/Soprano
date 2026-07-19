import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    collection,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ---------- Konfiguracja Firebase ----------
const firebaseConfig = {
    apiKey: "AIzaSyBu05x6c74DtJGF6NRBJBmRu7WFaRk-LWY",
    authDomain: "soprano-001.firebaseapp.com",
    projectId: "soprano-001",
    storageBucket: "soprano-001.firebasestorage.app",
    messagingSenderId: "675329228049",
    appId: "1:675329228049:web:237dacd601ccb10291e0b0",
    measurementId: "G-8J17XKB96M"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const hierarchyDocRef = doc(db, "soprano", "hierarchy");
const ADMIN_EMAIL = "edytor@soprano-001.internal"; // musi być identyczny z e-mailem dodanym w Firebase Auth

// ---------- Powiadomienia na Discord (przez bezpieczną Cloud Function) ----------
// Wklej tutaj adres URL swojej wdrożonej funkcji notifyDiscord (dostaniesz go po `firebase deploy --only functions`)
const NOTIFY_FUNCTION_URL = "WKLEJ_TU_ADRES_FUNKCJI";

async function notifyDiscord(message) {
    if (!NOTIFY_FUNCTION_URL || NOTIFY_FUNCTION_URL.includes("WKLEJ_TU")) return;
    try {
        await fetch(NOTIFY_FUNCTION_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
        });
    } catch (err) {
        console.error("Nie udało się wysłać powiadomienia na Discord:", err);
    }
}

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

// Przycisk rezerwacji sesji — otwiera modal zgłoszenia wpłaty
document.querySelector("#buyBtn")?.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("open-payment-modal"));
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
    // Rangi od najniższej do najwyższej. Members startuje ZAWSZE puste —
    // jedynym źródłem prawdy dla składu jest Firestore, nigdy kod strony.
    const ranks = [
        { id: "novizio", label: "Novizio", sub: "Nowicjusz", members: [] },
        { id: "membro", label: "Membro", sub: "Członek", members: [] },
        { id: "membro-permanente", label: "Membro Permanente", sub: "Stały członek", members: [] },
        { id: "soldato", label: "Soldato", sub: "Żołnierz", members: [] },
        { id: "caporegime", label: "Caporegime", sub: "Dowódca", members: [] },
        { id: "consigliere", label: "Consigliere", sub: "Doradca", members: [] },
        { id: "braccio-destro", label: "Braccio Destro", sub: "Prawa ręka szefa", members: [] },
        { id: "vice-capo", label: "Vice Capo", sub: "Zastępca szefa", members: [] },
        { id: "capo", label: "Capo", sub: "Szef", members: [] },
    ];

    // Domyślny skład używany WYŁĄCZNIE do jednorazowego zasilenia pustej bazy
    // (pierwsze uruchomienie nowego projektu Firebase). Nigdy nie jest renderowany
    // bezpośrednio — trafia do Firestore, a stamtąd wraca przez onSnapshot jak każda inna zmiana.
    const DEFAULT_MEMBERS = {
        soldato: [{ name: "Christopher", discordId: "" }],
        caporegime: [{ name: "Paulie", discordId: "" }],
        "braccio-destro": [{ name: "Silvio", discordId: "" }],
        capo: [{ name: "Tony", discordId: "" }],
    };

    const board = document.getElementById("hierarchyBoard");
    const editToggle = document.getElementById("editToggle");
    const addBar = document.getElementById("addMemberBar");
    const newNameInput = document.getElementById("newMemberName");
    const newDiscordIdInput = document.getElementById("newMemberDiscordId");
    const newRankSelect = document.getElementById("newMemberRank");
    const addBtn = document.getElementById("addMemberBtn");
    const hint = document.getElementById("hierarchyHint");

    if (!board) return;

    let editMode = false;
    let selected = null; // { name, discordId, from } — osoba zaznaczona stuknięciem, czeka na wybór rangi docelowej
    let firestoreReady = false; // true dopiero po odebraniu PRAWDZIWYCH danych z Firestore
    let firestoreError = false; // true, jeśli połączenie z bazą się nie powiodło

    function updateHint(){
        if (!editMode){ hint.textContent = ""; return; }
        if (!firestoreReady){ hint.textContent = "Wczytywanie hierarchii..."; return; }
        hint.textContent = selected
            ? `Zaznaczono: ${selected.name} — kliknij rangę docelową, aby przenieść.`
            : "Kliknij osobę, aby ją zaznaczyć, potem kliknij rangę docelową. Na komputerze możesz też przeciągnąć.";
    }

    function findRank(id){ return ranks.find(r => r.id === id); }

    // Sprawdza czy dana osoba w tablicy members to ta sama osoba co (name, discordId)
    function sameMember(m, name, discordId){
        return m.name === name && (m.discordId || "") === (discordId || "");
    }

    // Jeśli dane jeszcze się nie wczytały, blokuje akcję i informuje o tym zamiast pozwolić
    // na edycję, która i tak zostałaby po cichu utracona (saveToFirestore nic by nie zapisał).
    function ensureReadyOrWarn(){
        if (!firestoreReady){
            alert("Dane wciąż się wczytują — spróbuj za chwilę.");
            return false;
        }
        return true;
    }

    // Zamienia aktualny stan `ranks` na prosty obiekt { rankId: [{name, discordId}] } do zapisu w Firestore
    function ranksToPlainObject(){
        const obj = {};
        ranks.forEach(r => { obj[r.id] = r.members; });
        return obj;
    }

    // To samo co ranksToPlainObject, ale na bazie DEFAULT_MEMBERS — do jednorazowego zasiania bazy
    function defaultRanksPlainObject(){
        const obj = {};
        ranks.forEach(r => { obj[r.id] = DEFAULT_MEMBERS[r.id] || []; });
        return obj;
    }

    // Nadpisuje members w `ranks` na podstawie danych z Firestore.
    // Wsteczna kompatybilność: jeśli w bazie są jeszcze same stringi (sprzed zmiany),
    // zamienia je na {name, discordId: ""} zamiast się wywalić.
    function applyPlainObject(data){
        ranks.forEach(r => {
            const raw = Array.isArray(data?.[r.id]) ? data[r.id] : [];
            r.members = raw.map(m => typeof m === "string" ? { name: m, discordId: "" } : { name: m.name || "", discordId: m.discordId || "" });
        });
    }

    // Zapisuje aktualny stan do Firestore (współdzielone dla wszystkich odwiedzających)
    async function saveToFirestore(){
        if (!firestoreReady) return;
        try {
            await setDoc(hierarchyDocRef, ranksToPlainObject());
        } catch (err) {
            console.error("Nie udało się zapisać hierarchii:", err);
            alert("Nie udało się zapisać zmian na serwerze. Sprawdź połączenie i spróbuj ponownie.");
        }
    }

    function renderRankSelectOptions(){
        newRankSelect.innerHTML = "";
        ranks.forEach(rank => {
            const opt = document.createElement("option");
            opt.value = rank.id;
            opt.textContent = rank.label;
            newRankSelect.appendChild(opt);
        });
    }

    function render(){
        board.innerHTML = "";
        board.classList.toggle("edit-mode", editMode);
        board.classList.toggle("has-selection", editMode && !!selected);

        // Dopóki nie mamy prawdziwych danych z Firestore, nie pokazujemy ŻADNYCH imion —
        // ani domyślnych, ani starych — tylko jasny komunikat o stanie wczytywania.
        if (!firestoreReady){
            const msg = document.createElement("p");
            msg.style.cssText = "padding:2rem 1rem;text-align:center;opacity:0.7;font-style:italic;";
            msg.textContent = firestoreError
                ? "Nie udało się połączyć z serwerem hierarchii. Odśwież stronę lub spróbuj ponownie później."
                : "Ładowanie hierarchii…";
            board.appendChild(msg);
            renderRankSelectOptions();
            updateHint();
            return;
        }

        ranks.forEach(rank => {
            const col = document.createElement("div");
            col.className = "rank-column";
            col.dataset.rankId = rank.id;

            const h3 = document.createElement("h3");
            h3.textContent = rank.label;
            col.appendChild(h3);

            const sub = document.createElement("span");
            sub.className = "rank-sub";
            sub.textContent = rank.sub;
            col.appendChild(sub);

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

            rank.members.forEach(member => {
                const { name, discordId } = member;
                const chip = document.createElement("div");
                chip.className = "member-chip";
                if (selected && sameMember(member, selected.name, selected.discordId) && selected.from === rank.id){
                    chip.classList.add("selected");
                }
                chip.draggable = editMode;
                chip.dataset.name = name;
                if (discordId) chip.dataset.discordId = discordId;
                chip.title = discordId ? `Discord ID: ${discordId}` : "Brak podpiętego ID Discorda";

                const nameSpan = document.createElement("span");
                nameSpan.textContent = name;
                chip.appendChild(nameSpan);

                if (discordId){
                    const badge = document.createElement("span");
                    badge.className = "discord-linked-badge";
                    badge.textContent = "🔗";
                    badge.setAttribute("aria-hidden", "true");
                    chip.appendChild(badge);
                }

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "remove-member";
                removeBtn.setAttribute("aria-label", `Usuń ${name}`);
                removeBtn.textContent = "×";
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (!ensureReadyOrWarn()) return;
                    if (selected && sameMember(member, selected.name, selected.discordId) && selected.from === rank.id) selected = null;
                    rank.members = rank.members.filter(m => m !== member);
                    render();
                    saveToFirestore();
                    notifyDiscord(`👑 **${name}** usunięty/a z hierarchii (ranga: ${rank.label})`);
                });
                chip.appendChild(removeBtn);

                // Stuknięcie/klik: zaznacz osobę, albo odznacz jeśli już zaznaczona
                chip.addEventListener("click", (e) => {
                    if (!editMode) return;
                    e.stopPropagation();
                    if (selected && sameMember(member, selected.name, selected.discordId) && selected.from === rank.id){
                        selected = null;
                    } else {
                        selected = { name, discordId, from: rank.id };
                    }
                    render();
                });

                chip.addEventListener("dragstart", (e) => {
                    if (!editMode) return;
                    e.dataTransfer.setData("text/plain", JSON.stringify({ name, discordId, from: rank.id }));
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
                if (!ensureReadyOrWarn()) return;
                let data;
                try { data = JSON.parse(e.dataTransfer.getData("text/plain")); }
                catch { return; }
                const { name, discordId, from } = data;
                if (from === rank.id) return;
                const fromRank = findRank(from);
                if (fromRank) fromRank.members = fromRank.members.filter(m => !sameMember(m, name, discordId));
                rank.members.push({ name, discordId });
                render();
                saveToFirestore();
                notifyDiscord(`👑 **${name}** przeniesiony/a do rangi **${rank.label}**`);
            });

            // Stuknięcie w kolumnę (poza kartą osoby) przenosi zaznaczoną osobę na tę rangę
            col.addEventListener("click", () => {
                if (!editMode || !selected) return;
                if (!ensureReadyOrWarn()) return;
                if (selected.from !== rank.id){
                    const fromRank = findRank(selected.from);
                    if (fromRank) fromRank.members = fromRank.members.filter(m => !sameMember(m, selected.name, selected.discordId));
                    rank.members.push({ name: selected.name, discordId: selected.discordId });
                    saveToFirestore();
                    notifyDiscord(`👑 **${selected.name}** przeniesiony/a do rangi **${rank.label}**`);
                }
                selected = null;
                render();
            });

            board.appendChild(col);
        });

        renderRankSelectOptions();
        updateHint();
    }

    editToggle.addEventListener("click", async () => {
        if (editMode){
            editMode = false;
            selected = null;
            editToggle.classList.remove("active");
            editToggle.setAttribute("aria-pressed", "false");
            editToggle.querySelector(".edit-toggle-label").textContent = "Edytuj hierarchię";
            editToggle.querySelector(".lock-icon").textContent = "🔒";
            addBar.hidden = true;
            signOut(auth).catch(() => {});
            render();
            return;
        }
        const input = window.prompt("Podaj hasło, aby edytować hierarchię:");
        if (input === null) return;
        try {
            await signInWithEmailAndPassword(auth, ADMIN_EMAIL, input);
            editMode = true;
            selected = null;
            editToggle.classList.add("active");
            editToggle.setAttribute("aria-pressed", "true");
            editToggle.querySelector(".edit-toggle-label").textContent = "Zakończ edycję";
            editToggle.querySelector(".lock-icon").textContent = "🔓";
            addBar.hidden = false;
            render();
        } catch (err) {
            alert("Błędne hasło.");
        }
    });

    addBtn.addEventListener("click", () => {
        if (!editMode) return;
        if (!ensureReadyOrWarn()) return;
        const name = newNameInput.value.trim();
        if (!name) return;
        const discordId = newDiscordIdInput ? newDiscordIdInput.value.trim() : "";
        const rank = findRank(newRankSelect.value) || ranks[ranks.length - 1];
        rank.members.push({ name, discordId });
        newNameInput.value = "";
        if (newDiscordIdInput) newDiscordIdInput.value = "";
        render();
        newNameInput.focus();
        saveToFirestore();
        notifyDiscord(`👑 **${name}** dołączył/a do rangi **${rank.label}**`);
    });

    newNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") (newDiscordIdInput ? newDiscordIdInput.focus() : addBtn.click());
    });
    newDiscordIdInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addBtn.click();
    });

    // Pierwszy render pokazuje TYLKO stan „Ładowanie…" — żadnych domyślnych imion
    render();

    // ---------- Połączenie z Firestore ----------
    (async () => {
        try {
            const snap = await getDoc(hierarchyDocRef);
            if (!snap.exists()) {
                // Pierwsze uruchomienie w tym projekcie: zapisz domyślny skład jako punkt wyjścia
                await setDoc(hierarchyDocRef, defaultRanksPlainObject());
            }
        } catch (err) {
            console.error("Nie udało się zainicjować hierarchii w Firestore:", err);
            firestoreError = true;
            render();
        }

        // Nasłuchuj zmian na żywo — każda osoba widzi aktualizacje innych bez odświeżania strony
        onSnapshot(hierarchyDocRef, (snap) => {
            if (!snap.exists()) return;
            applyPlainObject(snap.data());
            firestoreReady = true;
            firestoreError = false;
            render();
        }, (err) => {
            console.error("Błąd nasłuchiwania Firestore:", err);
            firestoreError = true;
            render();
        });
    })();
})();

/* ---------- Ogłoszenia ---------- */
(() => {
    const announcementsDocRef = doc(db, "soprano", "announcements");

    const board = document.getElementById("announcementsBoard");
    const editToggle = document.getElementById("announcementsEditToggle");
    const addBar = document.getElementById("addAnnouncementBar");
    const titleInput = document.getElementById("newAnnouncementTitle");
    const textInput = document.getElementById("newAnnouncementText");
    const addBtn = document.getElementById("addAnnouncementBtn");
    const hint = document.getElementById("announcementsHint");

    if (!board) return;

    let items = [];
    let editMode = false;
    let ready = false;
    let errored = false;

    function updateHint(){
        if (!editMode){ hint.textContent = ""; return; }
        hint.textContent = ready ? "Dodaj ogłoszenie poniżej albo usuń istniejące." : "Wczytywanie ogłoszeń...";
    }

    function newId(){
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    async function save(){
        if (!ready) return;
        try {
            await setDoc(announcementsDocRef, { items });
        } catch (err) {
            console.error("Nie udało się zapisać ogłoszeń:", err);
            alert("Nie udało się zapisać zmian na serwerze. Sprawdź połączenie i spróbuj ponownie.");
        }
    }

    function render(){
        board.innerHTML = "";
        board.classList.toggle("edit-mode", editMode);

        if (!ready){
            const msg = document.createElement("p");
            msg.style.cssText = "padding:2rem 1rem;text-align:center;opacity:0.7;font-style:italic;";
            msg.textContent = errored
                ? "Nie udało się połączyć z serwerem ogłoszeń. Odśwież stronę lub spróbuj ponownie później."
                : "Ładowanie ogłoszeń…";
            board.appendChild(msg);
            updateHint();
            return;
        }

        if (items.length === 0){
            const empty = document.createElement("p");
            empty.className = "rank-empty";
            empty.style.textAlign = "center";
            empty.textContent = "— brak ogłoszeń —";
            board.appendChild(empty);
        }

        // Najnowsze ogłoszenia na górze
        items.slice().reverse().forEach(item => {
            const card = document.createElement("div");
            card.className = "announcement-card";

            const head = document.createElement("div");
            head.className = "announcement-head";

            const h3 = document.createElement("h3");
            h3.textContent = item.title;
            head.appendChild(h3);

            if (item.date){
                const date = document.createElement("span");
                date.className = "announcement-date";
                date.textContent = item.date;
                head.appendChild(date);
            }
            card.appendChild(head);

            const p = document.createElement("p");
            p.textContent = item.text;
            card.appendChild(p);

            if (editMode){
                const del = document.createElement("button");
                del.type = "button";
                del.className = "announcement-remove";
                del.setAttribute("aria-label", "Usuń ogłoszenie");
                del.textContent = "× usuń ogłoszenie";
                del.addEventListener("click", () => {
                    if (!ready) return;
                    items = items.filter(i => i.id !== item.id);
                    render();
                    save();
                });
                card.appendChild(del);
            }

            board.appendChild(card);
        });

        updateHint();
    }

    editToggle.addEventListener("click", async () => {
        if (editMode){
            editMode = false;
            editToggle.classList.remove("active");
            editToggle.setAttribute("aria-pressed", "false");
            editToggle.querySelector(".edit-toggle-label").textContent = "Edytuj ogłoszenia";
            editToggle.querySelector(".lock-icon").textContent = "🔒";
            addBar.hidden = true;
            render();
            return;
        }
        const input = window.prompt("Podaj hasło, aby edytować ogłoszenia:");
        if (input === null) return;
        try {
            await signInWithEmailAndPassword(auth, ADMIN_EMAIL, input);
            editMode = true;
            editToggle.classList.add("active");
            editToggle.setAttribute("aria-pressed", "true");
            editToggle.querySelector(".edit-toggle-label").textContent = "Zakończ edycję";
            editToggle.querySelector(".lock-icon").textContent = "🔓";
            addBar.hidden = false;
            render();
        } catch (err) {
            alert("Błędne hasło.");
        }
    });

    addBtn.addEventListener("click", () => {
        if (!editMode || !ready) return;
        const title = titleInput.value.trim();
        const text = textInput.value.trim();
        if (!title || !text) return;
        items.push({
            id: newId(),
            title,
            text,
            date: new Date().toLocaleDateString("pl-PL")
        });
        titleInput.value = "";
        textInput.value = "";
        render();
        titleInput.focus();
        save();
        notifyDiscord(`📢 **Nowe ogłoszenie:** ${title}\n${text}`);
    });

    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") textInput.focus(); });
    textInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });

    render();

    onSnapshot(announcementsDocRef, (snap) => {
        items = Array.isArray(snap.data()?.items) ? snap.data().items : [];
        ready = true;
        errored = false;
        render();
    }, (err) => {
        console.error("Błąd nasłuchiwania ogłoszeń:", err);
        errored = true;
        render();
    });
})();

/* ---------- Zapisy na capty ---------- */
(() => {
    const capturesDocRef = doc(db, "soprano", "captures");

    const board = document.getElementById("capturesBoard");
    const editToggle = document.getElementById("capturesEditToggle");
    const addBar = document.getElementById("addCaptureBar");
    const titleInput = document.getElementById("newCaptureTitle");
    const whenInput = document.getElementById("newCaptureWhen");
    const slotsInput = document.getElementById("newCaptureSlots");
    const addBtn = document.getElementById("addCaptureBtn");
    const hint = document.getElementById("capturesHint");

    if (!board) return;

    let events = [];
    let editMode = false;
    let ready = false;
    let errored = false;

    function updateHint(){
        if (!editMode){ hint.textContent = ""; return; }
        hint.textContent = ready ? "Dodaj cap poniżej albo usuń istniejący." : "Wczytywanie captów...";
    }

    function newId(){
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    async function save(){
        if (!ready) return;
        try {
            await setDoc(capturesDocRef, { events });
        } catch (err) {
            console.error("Nie udało się zapisać captów:", err);
            alert("Nie udało się zapisać zmian na serwerze. Sprawdź połączenie i spróbuj ponownie.");
        }
    }

    function render(){
        board.innerHTML = "";
        board.classList.toggle("edit-mode", editMode);

        if (!ready){
            const msg = document.createElement("p");
            msg.style.cssText = "padding:2rem 1rem;text-align:center;opacity:0.7;font-style:italic;";
            msg.textContent = errored
                ? "Nie udało się połączyć z serwerem captów. Odśwież stronę lub spróbuj ponownie później."
                : "Ładowanie captów…";
            board.appendChild(msg);
            updateHint();
            return;
        }

        if (events.length === 0){
            const empty = document.createElement("p");
            empty.className = "rank-empty";
            empty.style.textAlign = "center";
            empty.textContent = "— brak zaplanowanych captów —";
            board.appendChild(empty);
        }

        events.forEach(ev => {
            const card = document.createElement("div");
            card.className = "capture-card";

            const head = document.createElement("div");
            head.className = "capture-head";

            const h3 = document.createElement("h3");
            h3.textContent = ev.title;
            head.appendChild(h3);

            if (editMode){
                const del = document.createElement("button");
                del.type = "button";
                del.className = "remove-member";
                del.style.display = "inline-block";
                del.setAttribute("aria-label", "Usuń cap");
                del.textContent = "×";
                del.addEventListener("click", () => {
                    if (!ready) return;
                    events = events.filter(e => e.id !== ev.id);
                    render();
                    save();
                });
                head.appendChild(del);
            }
            card.appendChild(head);

            const when = document.createElement("span");
            when.className = "capture-when";
            when.textContent = ev.when;
            card.appendChild(when);

            const count = document.createElement("span");
            count.className = "capture-count";
            count.textContent = ev.maxSlots
                ? `${ev.signups.length} / ${ev.maxSlots} zapisanych`
                : `${ev.signups.length} zapisanych`;
            card.appendChild(count);

            const list = document.createElement("div");
            list.className = "capture-signups";

            if (ev.signups.length === 0){
                const empty = document.createElement("span");
                empty.className = "rank-empty";
                empty.textContent = "— brak zapisów —";
                list.appendChild(empty);
            }

            ev.signups.forEach(name => {
                const chip = document.createElement("div");
                chip.className = "member-chip";

                const nameSpan = document.createElement("span");
                nameSpan.textContent = name;
                chip.appendChild(nameSpan);

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "remove-member";
                removeBtn.setAttribute("aria-label", `Wypisz ${name}`);
                removeBtn.textContent = "×";
                removeBtn.addEventListener("click", () => {
                    if (!ready) return;
                    ev.signups = ev.signups.filter(n => n !== name);
                    render();
                    save();
                });
                chip.appendChild(removeBtn);

                list.appendChild(chip);
            });
            card.appendChild(list);

            // Formularz zapisu — dostępny dla każdego, bez hasła
            const signupForm = document.createElement("div");
            signupForm.className = "capture-signup-form";

            const signupInput = document.createElement("input");
            signupInput.type = "text";
            signupInput.placeholder = "Twoje imię / pseudo";
            signupInput.maxLength = 40;

            const signupBtn = document.createElement("button");
            signupBtn.type = "button";

            const full = ev.maxSlots && ev.signups.length >= ev.maxSlots;
            signupBtn.textContent = full ? "Brak miejsc" : "Zapisz się";
            signupBtn.disabled = full;

            signupBtn.addEventListener("click", () => {
                if (!ready) return;
                const name = signupInput.value.trim();
                if (!name) return;
                if (ev.signups.includes(name)){
                    alert("Już jesteś zapisany/a na ten cap.");
                    return;
                }
                if (ev.maxSlots && ev.signups.length >= ev.maxSlots){
                    alert("Brak wolnych miejsc na ten cap.");
                    return;
                }
                ev.signups.push(name);
                signupInput.value = "";
                render();
                save();
                notifyDiscord(`📝 **${name}** zapisał/a się na cap: **${ev.title}** (${ev.when})`);
            });
            signupInput.addEventListener("keydown", (e) => { if (e.key === "Enter") signupBtn.click(); });

            signupForm.appendChild(signupInput);
            signupForm.appendChild(signupBtn);
            card.appendChild(signupForm);

            board.appendChild(card);
        });

        updateHint();
    }

    editToggle.addEventListener("click", async () => {
        if (editMode){
            editMode = false;
            editToggle.classList.remove("active");
            editToggle.setAttribute("aria-pressed", "false");
            editToggle.querySelector(".edit-toggle-label").textContent = "Edytuj capty";
            editToggle.querySelector(".lock-icon").textContent = "🔒";
            addBar.hidden = true;
            render();
            return;
        }
        const input = window.prompt("Podaj hasło, aby edytować capty:");
        if (input === null) return;
        try {
            await signInWithEmailAndPassword(auth, ADMIN_EMAIL, input);
            editMode = true;
            editToggle.classList.add("active");
            editToggle.setAttribute("aria-pressed", "true");
            editToggle.querySelector(".edit-toggle-label").textContent = "Zakończ edycję";
            editToggle.querySelector(".lock-icon").textContent = "🔓";
            addBar.hidden = false;
            render();
        } catch (err) {
            alert("Błędne hasło.");
        }
    });

    addBtn.addEventListener("click", () => {
        if (!editMode || !ready) return;
        const title = titleInput.value.trim();
        const when = whenInput.value.trim();
        const rawSlots = slotsInput.value ? parseInt(slotsInput.value, 10) : null;
        if (!title || !when) return;
        events.push({
            id: newId(),
            title,
            when,
            maxSlots: (rawSlots && rawSlots > 0) ? rawSlots : null,
            signups: []
        });
        titleInput.value = "";
        whenInput.value = "";
        slotsInput.value = "";
        render();
        titleInput.focus();
        save();
    });

    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") whenInput.focus(); });
    whenInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });

    render();

    onSnapshot(capturesDocRef, (snap) => {
        events = Array.isArray(snap.data()?.events) ? snap.data().events : [];
        ready = true;
        errored = false;
        render();
    }, (err) => {
        console.error("Błąd nasłuchiwania captów:", err);
        errored = true;
        render();
    });
})();

/* ---------- Zgłoszenia płatności (widoczne tylko w konsoli Firebase, dla administracji) ---------- */
(() => {
    const modal = document.getElementById("paymentModal");
    const overlay = document.getElementById("paymentModalOverlay");
    const closeBtn = document.getElementById("paymentModalClose");
    const uidInput = document.getElementById("paymentUid");
    const nickInput = document.getElementById("paymentNick");
    const whenInput = document.getElementById("paymentWhen");
    const submitBtn = document.getElementById("paymentSubmitBtn");
    const hint = document.getElementById("paymentHint");

    if (!submitBtn || !modal) return;

    function openModal(){
        modal.hidden = false;
        hint.textContent = "";
        document.body.style.overflow = "hidden";
        uidInput.focus();
    }

    function closeModal(){
        modal.hidden = true;
        document.body.style.overflow = "";
    }

    document.addEventListener("open-payment-modal", openModal);
    overlay?.addEventListener("click", closeModal);
    closeBtn?.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modal.hidden) closeModal();
    });

    submitBtn.addEventListener("click", async () => {
        const uid = uidInput.value.trim();
        const nick = nickInput.value.trim();
        const when = whenInput.value.trim();

        if (!uid || !nick || !when) {
            hint.textContent = "Uzupełnij UID, nick oraz datę wpłaty.";
            return;
        }

        submitBtn.disabled = true;
        hint.textContent = "Wysyłanie...";
        try {
            // Zapis do osobnej kolekcji "payments" — reguły Firestore ograniczają
            // ODCZYT tej kolekcji wyłącznie do zalogowanego konta admina (ADMIN_EMAIL).
            // Każdy może DODAĆ zgłoszenie, ale nikt poza adminem nie może go odczytać.
            await addDoc(collection(db, "payments"), {
                uid,
                nick,
                when,
                submittedAt: serverTimestamp()
            });
            uidInput.value = "";
            nickInput.value = "";
            whenInput.value = "";
            hint.textContent = "Dziękujemy! Zgłoszenie zostało zapisane.";
            notifyDiscord(`💰 **Zgłoszenie wpłaty:** ${nick} (UID: ${uid}) — ${when}`);
            setTimeout(closeModal, 1500);
        } catch (err) {
            console.error("Nie udało się zapisać zgłoszenia płatności:", err);
            hint.textContent = "Nie udało się wysłać zgłoszenia. Spróbuj ponownie.";
        } finally {
            submitBtn.disabled = false;
        }
    });

    [uidInput, nickInput, whenInput].forEach(input => {
        input?.addEventListener("keydown", (e) => { if (e.key === "Enter") submitBtn.click(); });
    });
})();
