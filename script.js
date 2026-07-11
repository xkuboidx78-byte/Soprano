import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    onSnapshot
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
    const ADMIN_EMAIL = "edytor@soprano-001.internal"; // musi być identyczny z e-mailem dodanym w Firebase Auth

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
        soldato: ["Christopher"],
        caporegime: ["Paulie"],
        "braccio-destro": ["Silvio"],
        capo: ["Tony"],
    };

    const board = document.getElementById("hierarchyBoard");
    const editToggle = document.getElementById("editToggle");
    const addBar = document.getElementById("addMemberBar");
    const newNameInput = document.getElementById("newMemberName");
    const newRankSelect = document.getElementById("newMemberRank");
    const addBtn = document.getElementById("addMemberBtn");
    const hint = document.getElementById("hierarchyHint");

    if (!board) return;

    let editMode = false;
    let selected = null; // { name, from } — osoba zaznaczona stuknięciem, czeka na wybór rangi docelowej
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

    // Jeśli dane jeszcze się nie wczytały, blokuje akcję i informuje o tym zamiast pozwolić
    // na edycję, która i tak zostałaby po cichu utracona (saveToFirestore nic by nie zapisał).
    function ensureReadyOrWarn(){
        if (!firestoreReady){
            alert("Dane wciąż się wczytują — spróbuj za chwilę.");
            return false;
        }
        return true;
    }

    // Zamienia aktualny stan `ranks` na prosty obiekt { rankId: [imiona] } do zapisu w Firestore
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

    // Nadpisuje members w `ranks` na podstawie danych z Firestore
    function applyPlainObject(data){
        ranks.forEach(r => {
            r.members = Array.isArray(data?.[r.id]) ? data[r.id] : [];
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

            rank.members.forEach(name => {
                const chip = document.createElement("div");
                chip.className = "member-chip";
                if (selected && selected.name === name && selected.from === rank.id){
                    chip.classList.add("selected");
                }
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
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (!ensureReadyOrWarn()) return;
                    if (selected && selected.name === name && selected.from === rank.id) selected = null;
                    rank.members = rank.members.filter(m => m !== name);
                    render();
                    saveToFirestore();
                });
                chip.appendChild(removeBtn);

                // Stuknięcie/klik: zaznacz osobę, albo odznacz jeśli już zaznaczona
                chip.addEventListener("click", (e) => {
                    if (!editMode) return;
                    e.stopPropagation();
                    if (selected && selected.name === name && selected.from === rank.id){
                        selected = null;
                    } else {
                        selected = { name, from: rank.id };
                    }
                    render();
                });

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
                if (!ensureReadyOrWarn()) return;
                let data;
                try { data = JSON.parse(e.dataTransfer.getData("text/plain")); }
                catch { return; }
                const { name, from } = data;
                if (from === rank.id) return;
                const fromRank = findRank(from);
                if (fromRank) fromRank.members = fromRank.members.filter(m => m !== name);
                rank.members.push(name);
                render();
                saveToFirestore();
            });

            // Stuknięcie w kolumnę (poza kartą osoby) przenosi zaznaczoną osobę na tę rangę
            col.addEventListener("click", () => {
                if (!editMode || !selected) return;
                if (!ensureReadyOrWarn()) return;
                if (selected.from !== rank.id){
                    const fromRank = findRank(selected.from);
                    if (fromRank) fromRank.members = fromRank.members.filter(m => m !== selected.name);
                    rank.members.push(selected.name);
                    saveToFirestore();
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
        const rank = findRank(newRankSelect.value) || ranks[ranks.length - 1];
        rank.members.push(name);
        newNameInput.value = "";
        render();
        newNameInput.focus();
        saveToFirestore();
    });

    newNameInput.addEventListener("keydown", (e) => {
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
