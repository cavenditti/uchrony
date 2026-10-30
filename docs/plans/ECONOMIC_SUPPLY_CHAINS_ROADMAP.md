# Piano delle prossime filiere produttive

Stato: piano di sviluppo aggiornato al 30 ottobre 2026. Il primo ampliamento
a ventotto beni è implementato; le sezioni seguenti distinguono il codice attuale
dagli obiettivi successivi. L'ordine indica la priorità di sviluppo, non una
cronologia storica obbligata per gli stati simulati.

## Punto di partenza

Il catalogo attuale contiene ventotto beni. Il primo incremento collega minerale
di ferro e carbone vegetale alla produzione di ferro lavorato, e lana alla
produzione tessile. Imprese, lavoro, scorte, prezzi, credito e trasporti sono già
presenti. La descrizione del comportamento implementato è in
[Physical supply chains](../SUPPLY_CHAINS.md).

Sono ora presenti argilla e mattoni; cereali, farina e pane; sale, pesca costiera
e alimenti conservati; coke e acciaio; lino, cotone, canapa e corde; minerale
prezioso, metallo prezioso e gioielli. Le sezioni seguenti conservano gli obiettivi
più ampi: calce, chimica, allevamento dettagliato, pesca d'altura e conversioni
industriali con investimento e ritardo restano da sviluppare. La selezione attuale
di fibre e acciaio è una sostituzione di materiali, senza progetti di conversione.

Una nuova risorsa entra nel catalogo solo se ha un utilizzatore concreto e
introduce una scelta economica osservabile: localizzazione, sostituzione,
stagionalità, investimento, conservazione o dipendenza commerciale. Gli effetti
devono passare attraverso quantità, costi e capacità, senza bonus gratuiti al PIL.

## Ordine proposto

| Priorità | Filiera                       | Nuovi beni candidati                                | Utilizzatori e comportamento atteso                                                                                                 |
| -------- | ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Edilizia                      | Argilla, mattoni, calcare, calce                    | Case, magazzini, impianti e opere pubbliche comprano materiali; combustibile e forniture locali cambiano il costo di costruire.     |
| 2        | Alimentazione e conservazione | Cereali, farina, sale, alimenti conservati          | Famiglie, eserciti e spedizioni hanno prodotti commestibili con conservabilità diversa; raccolti e scorte diventano più importanti. |
| 3        | Energia e siderurgia          | Coke, acciaio                                       | Nuovi impianti possono adottare tecniche diverse; utensili, armamenti e infrastrutture avanzate richiedono materiali appropriati.   |
| 4        | Fibre e navigazione           | Lino, cotone, canapa, corde                         | Tessiture e cantieri navali generano domanda agricola e industriale; colture tessili e alimentari competono per terreno e lavoro.   |
| 5        | Chimica agricola e militare   | Zolfo, salnitro, polvere da sparo, fosfati, concimi | Agricoltura e armamenti dipendono da materiali specializzati; gli impianti chimici hanno costi e capacità reali.                    |

I candidati di una fase non devono essere introdotti tutti nello stesso rilascio.
Ogni incremento può aggiungere due o tre beni, purché la filiera risultante sia
utilizzabile e completa. Quantità e rese vanno calibrate con esperimenti; la
tabella non pretende di descrivere processi industriali in dettaglio.

## 1. Edilizia: ampliamento implementato e passi successivi

Incremento implementato: **argilla → mattoni**, con consumo di combustibile,
lavoro e capacità di fornace. Incremento successivo: **calcare → calce**, con una
propria lavorazione e un impiego esplicito negli edifici.

L'argilla deve avere una distribuzione geografica riproducibile e distinta dal
minerale metallico. Il calcare richiede una dotazione geologica specifica: non ogni tonnellata
della pietra generica deve diventare automaticamente calcare utilizzabile.

Le ricette edilizie devono offrire progetti alternativi, per esempio costruzioni
in legno, pietra o muratura. Una scelta cambia materiali, lavoro, costo e proprietà
fisiche dell'edificio, con parametri dichiarati. I progetti già avviati mantengono
gli impegni originali. Un mondo senza mattoni può continuare a costruire con la ricetta in pietra,
senza ricevere materiali gratuiti.

**Verifica decisiva:** due distretti uguali, ma con disponibilità diversa di
argilla, scelgono forniture o tecniche edilizie diverse. Una fornace non produce
senza lavoro e combustibile; una casa non compare prima del completamento.

## 2. Alimentazione: raccolti, scorte e conservazione

Sono implementati **cereali → farina → pane** e **pesce + sale → alimenti
conservati**. Il bene `food` resta l'aggregato commestibile ordinario; pane, pesce
e alimenti conservati possono sostituirlo negli acquisti delle famiglie.
Cereali e farina sono intermedi in questa prima versione.

Il piano deve distinguere resa materiale, contenuto alimentare e perdite di
lavorazione: trasformare un alimento non può creare nutrimento o far contare due
volte lo stesso pasto. Raccolti e attività agricole devono rispettare il clima
locale e l'emisfero; lavoro preparatorio e raccolta non devono diventare due
produzioni indipendenti dello stesso terreno.

La conservazione riduce le perdite e può rendere sostenibili viaggi più lunghi,
ma consuma sale, lavorazione e capacità. Le famiglie devono poter continuare ad
alimentarsi anche dove manca il sale. Le merci conservate non sono esenti da
deperimento, trasporto o pagamento.

La pesca costiera usa stock condivisi e recupero biologico. Carne, latte e
allevamenti dettagliati sono estensioni successive: richiedono stock animali,
alimentazione, riproduzione e macellazione;
lana e carne non devono poter sfruttare due volte lo stesso allevamento.

**Verifica decisiva:** un cattivo raccolto pesa meno su un territorio che ha
acquistato e mantenuto scorte; la conservazione non genera calorie, denaro o cibo
gratuito e non rende obbligatorio salare tutta l'alimentazione civile.

## 3. Energia e siderurgia: tecniche produttive alternative

Sono implementati **carbone fossile → coke** e **ferro + coke → acciaio**, con
input e impianti espliciti. La prima tecnica del ferro a carbone vegetale resta
utilizzabile; le conversioni di impianto descritte sotto sono ancora da sviluppare.

Occorre prima un contratto comune per le tecniche produttive: ricerca richiesta,
impianto compatibile, input, resa, capacità, consumo energetico e costo della
conversione. Le imprese confrontano il costo consegnato degli input e i ricavi
attesi. Cambiare tecnica richiede un investimento e un tempo di conversione;
la sostituzione non avviene solo perché un combustibile costa meno.

L'acciaio entra solo insieme a utilizzatori distinti, per esempio utensili e
componenti per ferrovie o armamenti di livello avanzato. Gli impianti esistenti
non diventano obsoleti per una data di calendario. Il capitale vecchio può
continuare a operare, essere convertito o chiudere in base alle condizioni.

**Verifica decisiva:** rincarare un combustibile modifica margini, commercio e
investimenti; una conversione finanziata può ridurre la dipendenza, mentre un
impianto incompatibile non può usare automaticamente il sostituto.

## 4. Fibre: specializzazione agricola e cantieri

La tessitura può usare **lino**, **cotone** o lana. La filiera **canapa → corde**
è implementata e i cantieri acquistano corde e tessuti per costruire navi.
Manutenzione navale dettagliata e costi delle conversioni tessili restano futuri;
non serve introdurre un ulteriore bene quasi identico per le vele.

Le colture hanno idoneità geografiche e stagionali dichiarate. Terre e lavoro
agricolo sono condivisi con le colture alimentari: lo stesso ettaro non può
produrre contemporaneamente la resa piena di cereali, cotone e pascolo. Le
diverse fibre non diventano sostituti perfetti in ogni processo.

**Verifica decisiva:** domanda tessile e navale può attrarre colture commerciali,
ma fa emergere il costo opportunità del cibo e l'eventuale necessità di importarlo.
La costruzione di una flotta consuma effettivamente le forniture dei cantieri.

## 5. Chimica: nuovi vincoli per agricoltura e guerra

Prima estensione: **zolfo + salnitro + carbone vegetale → polvere da sparo**,
come ricetta semplificata di gioco. La polvere alimenta una tecnica appropriata
di produzione delle armi e, quando previsto, consumi di munizioni degli eserciti.
Non deve diventare un requisito retroattivo per tutte le armi esistenti.

Seconda estensione: **fosfati + reagenti → concimi**, con una tecnica industriale
definita prima dell'implementazione. Il concime deve avere dose, costo e risposta
agronomica limitata; non sostituisce terra, acqua, lavoro o stagioni e non produce
fertilità permanente illimitata attraverso acquisti ripetuti.

**Verifica decisiva:** interrompere una fornitura riduce la produzione dipendente
o il rifornimento militare. Il beneficio dei concimi deriva dall'uso fisico di
quantità acquistate e ha rendimenti decrescenti verificabili.

## Estensioni dopo queste fasi

- **Sabbia, vetro e carta:** solo insieme a domanda concreta di edifici, famiglie,
  amministrazione o istruzione; acquistare carta non genera ricerca da solo.
- **Rame, stagno e bronzo:** introdurli quando esistono ricette e utilizzatori
  distinti, o una scelta tecnologica alternativa significativa. Non aggiungere
  tre metalli che si comportano come copie del ferro.
- **Macchinari e ricambi:** rendere materiale parte della formazione e della
  manutenzione del capitale, contabilizzando l'usura già presente senza contarla
  due volte. Richiede capacità installata per tecnica, non solo capitale generico.
- **Petrolio, carburanti e gomma:** fase successiva a motori e utilizzatori reali;
  prima servono esplorazione, estrazione, raffinazione e consumo dei mezzi.
- **Elettricità:** affrontarla come rete con capacità e perdite, non come normale
  merce stoccabile e trasportabile sui carri.

## Regole comuni e completamento di ogni incremento

1. **Dati unici:** catalogo dei beni, tecniche e ricette alimentano produzione,
   domanda intermedia, scorte, investimenti, comandi e interfaccia. Eventuali
   coprodotti devono consumare gli input una sola volta e avere sbocchi verificati.
2. **Geografia e capacità:** distinguere giacimenti finiti, risorse rinnovabili,
   colture e trasformazioni. Raffinare la mappa non crea depositi, terra o impianti.
3. **Lavoro e finanza:** attività concorrenti condividono lavoratori, terreno,
   combustibile e impianti. Ordini non eseguibili restano visibili; i fornitori
   sono pagati e credito, ricavi, PIL e patrimonio restano conti distinti.
4. **Persistenza:** lo schema attuale richiede inventari completi e rifiuta
   salvataggi precedenti o incompleti, senza migrazione. Quantità, riserve e
   impegni devono sopravvivere al ripristino. Nuove dotazioni sono esplicite
   solo nella creazione degli scenari; il caricamento non reintegra scorte esaurite.
5. **Verifica:** test unitari e di regressione per input mancanti, sostituzioni,
   limiti geografici, conservazione, contabilità e ripristino. Confronti a seed
   uguale, interruzione di una fornitura e prosecuzione dopo salvataggio. Eseguire
   build, suite e formattazione richieste dal repository.
6. **Scala e valutazione:** misurare tempo per mese, memoria, numero di rotte e
   costo del salvataggio rispetto al riferimento, con modello e runtime fissati.
   Registrare fame, occupazione, prezzi, investimenti e fallimenti, oltre al PIL.
   Le prove contabili non dimostrano calibrazione storica o stabilità secolare.

Le prove native controllate devono disattivare le chiamate esterne ai modelli.
Durate, seed, metriche e confronti vanno dichiarati prima delle simulazioni di
valutazione. La qualificazione delle nuove filiere resta distinta dalla soluzione
dei problemi già presenti nella lottizzazione e nella calibrazione generale.

## Prossimo pacchetto concreto

Argilla, mattoni, fornaci e sostituzione parziale della pietra sono implementati,
insieme alle prime filiere alimentari, siderurgiche, tessili e del lusso.
I prossimi incrementi richiedono verifiche distinte: calcare e calce con un uso
edilizio esplicito, oppure conversioni industriali finanziate e ritardate al
posto delle attuali sostituzioni immediate di materiali. Chimica, allevamento
dettagliato e pesca d'altura restano obiettivi futuri, senza beni o capacità
impliciti nell'ampliamento attuale.
