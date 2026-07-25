# Appendix: Guida di Studio per il Progetto

Questa guida elenca cosa studiare per progettare, verificare e spiegare il simulatore. L'ordine e' intenzionale: prima i concetti necessari per una prima versione affidabile, poi gli argomenti avanzati.

## 1. Mappa di Studio

| Priorita' | Argomento | Perche' serve nel progetto |
| --- | --- | --- |
| Essenziale | Rendimenti, capitalizzazione e portafogli | Ogni motore genera rendimenti che devono diventare valore di portafoglio. |
| Essenziale | Probabilita', statistica descrittiva e campionamento | Servono per bootstrap, metriche e lettura dei risultati. |
| Essenziale | Monte Carlo e numeri pseudo-casuali | Serve per produrre percorsi riproducibili e spiegare l'incertezza. |
| Essenziale | Correlazione, covarianza e matrici | Servono per simulare piu' asset congiuntamente. |
| Essenziale | Web Worker, TypedArray e trasferimento di buffer | Servono per mantenere reattiva l'interfaccia nel browser. |
| Importante | Distribuzione Student's $t$ multivariata | E' il motore parametrico del progetto. |
| Importante | Ribilanciamento, tasse, cost basis e leva | Sono le regole che trasformano un percorso di rendimenti in un investimento reale. |
| Importante | Test deterministici e validazione finanziaria | Sono necessari per non ottenere risultati plausibili ma errati. |
| Futuro | Catene di Markov e regimi di mercato | Consentono di introdurre persistenza di regimi e crisi. |
| Futuro | Bootstrap a blocchi, HMM e stima robusta | Migliorano il realismo, ma aumentano molto complessita' e rischio di errori. |

## 2. Fondamenti Finanziari

### Rendimenti semplici e log-rendimenti

Il rendimento semplice di un asset tra due date e':

$$
r_t = \frac{P_t}{P_{t-1}} - 1
$$

dove $P_t$ deve essere un prezzo **total return** o adjusted close: dividendi e split sono gia' incorporati. Il valore evolve come:

$$
V_t = V_{t-1}(1 + r_t)
$$

Il log-rendimento e':

$$
\ell_t = \log(1 + r_t)
$$

I log-rendimenti si sommano nel tempo, mentre i rendimenti semplici compongono direttamente il valore. Il motore Student's $t$ del progetto modella i log-rendimenti e poi torna al rendimento semplice con:

$$
r_t = e^{\ell_t} - 1
$$

Questo evita rendimenti simulati inferiori a $-100\%$, che renderebbero negativo il valore di un asset long-only.

### Portafoglio senza leva

Con pesi $w_i$ che sommano a uno, il rendimento semplice di portafoglio per un periodo e':

$$
r_{p,t} = \sum_{i=1}^{n} w_{i,t-1} r_{i,t}
$$

I pesi cambiano dopo i rendimenti. Per questo il ribilanciamento non puo' essere ridotto a una media fissa dei rendimenti: occorre mantenere valore e quantita' di ogni posizione.

### Portafoglio con leva

Definizioni da usare in modo coerente:

$$
	ext{equity} = \text{gross asset value} - \text{debt}
$$

$$
	ext{gross exposure} = \frac{\text{gross asset value}}{\text{equity}}
$$

$$
	ext{maintenance margin} = \frac{\text{equity}}{\text{gross asset value}}
$$

Con $4\times$ di gross exposure la maintenance margin iniziale e' $25\%$. Non esiste margine di sicurezza: anche una piccola perdita, interessi o costi possono attivare una margin call. Questa e' la ragione matematica del limite di leva del progetto.

### Contributi e flussi di cassa

Nel progetto il contributo ricorrente arriva a fine periodo. Non guadagna il rendimento di quel periodo. Questa convenzione deve restare identica nei test, nel motore e nei grafici.

Un valore finale alto con contributi ricorrenti non implica un rendimento elevato. Per questo:

* usare CAGR solo per un investimento iniziale senza flussi successivi;
* usare IRR o money-weighted return quando esistono contributi;
* usare una serie di rendimenti di portafoglio senza flussi per volatilita', Sharpe e drawdown.

### Tasse, cost basis e costi

Il modello e' una semplificazione didattica, non una consulenza fiscale:

* ogni asset ha un average cost basis;
* una vendita realizza $\text{proceeds} - \text{basis sold}$;
* le perdite realizzate possono compensare guadagni futuri nello stesso percorso, senza rimborso fiscale;
* i costi di acquisto aumentano il basis; quelli di vendita riducono i proceeds;
* la liquidazione finale vende tutto e calcola tasse e costi residui.

Da studiare: differenza tra plusvalenza realizzata e non realizzata, metodo FIFO rispetto al costo medio, tax-loss harvesting e limiti della semplificazione scelta.

### Inflazione e valuta base

Il simulatore contabilizza prima in valuta nominale. Per un risultato reale, deflaziona il valore nominale con un indice di inflazione coerente con la valuta base:

$$
V_t^{real} = \frac{V_t^{nominal}}{I_t / I_0}
$$

Un portafoglio in USD richiede rendimenti convertiti in USD, CPI statunitense e tasso short USD. Un portafoglio in EUR richiede rendimenti convertiti in EUR, HICP e un tasso short EUR. Mescolare rendimenti locali senza conversione FX non e' finanziariamente corretto.

## 3. Probabilita' e Statistica

### Variabili casuali e campionamento

Una simulazione Monte Carlo genera molte osservazioni casuali dello stesso modello. Non produce una previsione certa; stima una distribuzione di possibili esiti.

Per una metrica $X$, la media campionaria e':

$$
\bar{X} = \frac{1}{N}\sum_{j=1}^{N}X_j
$$

L'errore Monte Carlo della media cala approssimativamente come $1/\sqrt{N}$. Per dimezzarlo servono circa quattro volte piu' percorsi. Questo e' fondamentale quando si sceglie il numero di simulazioni nel browser.

### Media, varianza e deviazione standard

Per rendimenti $r_1, \ldots, r_T$:

$$
s^2 = \frac{1}{T-1}\sum_{t=1}^{T}(r_t - \bar{r})^2
$$

La volatilita' annualizzata e' $s\sqrt{12}$ per dati mensili o $s\sqrt{52}$ per dati settimanali. L'annualizzazione presume osservazioni comparabili e non elimina il rischio di non normalita'.

### Percentili e quantili

Il percentile $q$ indica un valore sotto il quale cade una certa frazione dei risultati. Il grafico mostra i percentili 10, 25, 50, 75 e 90 a ogni periodo.

Una banda di percentili non e' un percorso reale: il valore al 10esimo percentile di un mese puo' appartenere a un percorso diverso da quello del mese successivo. Per questo solo i percorsi individuali conservati sono cliccabili.

### Correlazione e covarianza

La covarianza misura come due rendimenti si muovono insieme. La correlazione la normalizza tra $-1$ e $1$:

$$
\rho_{ij} = \frac{\operatorname{Cov}(r_i, r_j)}{\sigma_i\sigma_j}
$$

La correlazione storica non e' stabile, soprattutto nelle crisi. Va vista come un input stimato, non come una legge di mercato.

### Matrici positive semidefinite

Una matrice di covarianza usata per generare shock congiunti deve essere positiva semidefinita. Errori numerici, dati scarsi o asset quasi duplicati possono produrre valori propri negativi e far fallire Cholesky.

L'algoritmo di Higham trova una matrice di correlazione vicina a quella stimata che sia valida. Studiare:

* autovalori e autovettori;
* decomposizione di Cholesky;
* differenza tra covarianza e correlazione;
* perche' la riparazione deve preservare le varianze degli asset.

## 4. Monte Carlo nel Progetto

### Percorso di simulazione

Un percorso contiene una sequenza di scenari di periodo. Ogni scenario include:

* rendimenti congiunti degli asset;
* inflazione;
* tasso risk-free o costo base del debito;
* metadati opzionali: riga storica o regime Markov.

Il motore genera scenari. Il loop di portafoglio applica sempre la stessa contabilita': rendimenti, interessi, contributo, margin call, ribilanciamento, tasse e registrazione del risultato. Separare questi due compiti e' la principale regola di progettazione del simulatore.

### Historical joint bootstrap

Procedura:

1. Creare una matrice storica allineata per tutti gli asset selezionati, inflazione e tassi.
2. Rimuovere le righe con dati mancanti.
3. Estrarre una riga casuale con rimpiazzo per ogni periodo simulato.
4. Passare tutti i valori della riga al portafoglio insieme.

Vantaggi: semplice, trasparente, conserva shock reali e correlazioni contemporanee.

Limiti: non conserva l'ordine temporale dei mercati, la persistenza della volatilita' o la durata delle crisi. Non dire che conserva "tutta" la dipendenza storica: conserva solo quella osservata nello stesso periodo.

### Motore parametrico Student's $t$

Una normale multivariata tende a sottostimare eventi estremi. La Student's $t$ ha code piu' pesanti; il parametro $\nu$ controlla quanto sono pesanti. Quando $\nu$ cresce, la distribuzione tende alla normale.

Nel progetto:

1. stimare media e covarianza dei log-rendimenti allineati;
2. stimare $\nu$ dalla curtosi in eccesso dei residui standardizzati;
3. correggere la matrice di correlazione se necessario;
4. generare shock Student's $t$ congiunti;
5. convertire i log-rendimenti in rendimenti semplici;
6. applicare il normale loop di portafoglio.

Per $\nu > 2$, la matrice di scala $S$ non coincide con la covarianza $\Sigma$:

$$
S = \Sigma\frac{\nu - 2}{\nu}
$$

Confondere le due matrici produce una simulazione con volatilita' errata.

### Pseudo-casualita', seed e riproducibilita'

Un generatore pseudo-casuale e' deterministico dato uno stato iniziale. Il progetto usa `xoshiro128**` con seed a 32 bit:

* stesso seed, stessi dati e stessa versione del modello devono generare lo stesso risultato;
* non usare `Math.random()`, che non consente test ripetibili;
* il generatore non e' crittografico e non deve essere usato per sicurezza;
* registrare seed, versione dataset e versione del modello nell'export.

Studiare anche trasformazioni da uniformi a normali, per esempio Box-Muller, e come ottenere una Student's $t$ da normali e una variabile chi-quadro.

## 5. Catene di Markov e Regimi di Mercato

### Concetto di base

Una catena di Markov discreta ha stati $S_t \in \{1, \ldots, K\}$. La probabilita' dello stato successivo dipende solo dallo stato corrente:

$$
P(S_{t+1}=j \mid S_t=i) = P_{ij}
$$

La matrice $P$ e' una transition matrix: ogni elemento e' non negativo e ogni riga somma a uno. Il vettore $\pi$ contiene le probabilita' iniziali degli stati.

### Perche' e' utile qui

Un bootstrap indipendente puo' estrarre un mese di crisi e poi subito un mese tranquillo. Un modello Markov puo' assegnare maggiore probabilita' a periodi difficili dopo un periodo difficile, se questa persistenza e' presente nei dati.

Esempio didattico con tre stati:

| Regime | Interpretazione possibile | Emissione |
| --- | --- | --- |
| 0 | Mercato calmo | Righe storiche a bassa volatilita' |
| 1 | Mercato normale | Righe storiche intermedie |
| 2 | Stress | Righe storiche con drawdown o alta volatilita' |

Lo stato non e' una previsione economica. E' una classificazione statistica dei dati storici.

### Prima implementazione consigliata

La prima versione Markov non deve stimare una distribuzione nuova per ogni regime. Procedura semplice:

1. Costruire la matrice storica allineata gia' usata dagli altri motori.
2. Assegnare ogni riga a un piccolo numero di regimi con una regola documentata.
3. Contare le transizioni osservate tra stati consecutivi per stimare $P$.
4. Stimare $\pi$ dalla frequenza storica iniziale o dalla distribuzione stazionaria.
5. Simulare lo stato successivo con la riga di $P$ corrispondente.
6. Estrarre una riga storica appartenente a quel regime.
7. Passare la riga intera al portfolio loop.

Questa soluzione conserva correlazioni cross-asset perche' emette righe storiche complete. E' anche piu' leggibile di un modello a molte distribuzioni parametriche.

### Scelte da rendere esplicite prima di implementare

* Numero di regimi: iniziare con 2 o 3.
* Metodo per definire i regimi: soglie su volatilita'/rendimento, clustering deterministico o hidden Markov model.
* Feature usate per classificare: rendimento dell'indice azionario, volatilita' rolling, drawdown, spread creditizi oppure una combinazione.
* Politica per regimi con poche righe: unirli, rifiutare il modello o usare smoothing.
* Frequenza: gli stati settimanali e mensili non sono direttamente intercambiabili.

### Limiti e argomenti avanzati

Le catene Markov di primo ordine assumono che solo lo stato corrente conti. Possono creare cambi di regime troppo netti e dipendono molto dal metodo di classificazione.

Argomenti successivi:

* matrice di transizione stazionaria e distribuzione stazionaria $\pi P = \pi$;
* tempo medio di permanenza nello stato $i$: circa $1/(1-P_{ii})$;
* smoothing di Laplace per evitare probabilita' zero;
* hidden Markov model (HMM), algoritmo forward-backward ed EM/Baum-Welch;
* Markov-switching models e emissioni Student's $t$ per regime;
* validazione out-of-sample, per evitare di scambiare overfitting per realismo.

## 6. Metriche e Interpretazione dei Risultati

### Drawdown

Il drawdown misura la perdita dal massimo precedente:

$$
DD_t = \frac{V_t}{\max_{u \le t} V_u} - 1
$$

Nel simulatore va calcolato su un indice unitizzato, non sul valore con contributi. Altrimenti un contributo puo' sembrare una ripresa del mercato.

### Sharpe ratio

Una definizione periodica e':

$$
	ext{Sharpe} = \frac{\overline{r_p-r_f}}{s(r_p-r_f)}\sqrt{m}
$$

dove $m$ vale 12 o 52. Lo Sharpe non misura il rischio di coda e puo' essere fuorviante con distribuzioni asimmetriche, leva o rendimenti non indipendenti.

### Metriche di coda

Da studiare per versioni future:

* Value at Risk (VaR): soglia di perdita a un dato percentile;
* Conditional VaR o Expected Shortfall: perdita media oltre il VaR;
* probability of ruin: probabilita' di insolvenza o di un obiettivo non raggiunto;
* sequence-of-returns risk: impatto dell'ordine dei rendimenti su portafogli con flussi di cassa.

Non presentare queste metriche come probabilita' oggettive: dipendono interamente dal modello e dai dati scelti.

## 7. Ingegneria del Software per il Browser

### Separazione delle responsabilita'

Il progetto usa quattro livelli semplici:

* `features/`: componenti React, input e risultati;
* `core/data/`: caricamento e validazione dei dati statici;
* `core/simulation/`: generatori di `PeriodScenario`;
* `core/portfolio/`: contabilita' pura e indipendente dal metodo di simulazione.

Il Web Worker coordina calcolo e batching; React non contiene formule finanziarie. Questa separazione permette di confrontare due motori usando gli stessi scenari e di testare la contabilita' senza il browser.

### TypeScript essenziale

Da studiare:

* tipi discriminati per `engine: 'bootstrap' | 'studentT' | 'markov'`;
* `readonly` per input che non devono mutare;
* `Float32Array` e `Float64Array`;
* unioni, type guard e validazione runtime dei dati JSON;
* differenza tra `number` JavaScript e valori in typed array.

I file `.f32` sono compatti per il trasferimento. Le operazioni di contabilita' devono usare `number`, cioe' precisione IEEE-754 double, non `Float32`.

### React e stato della simulazione

Il simulatore deve mantenere lo stato dell'input separato dallo stato di esecuzione:

* configurazione valida o errori di validazione;
* ID della run corrente;
* stato `idle`, `running`, `completed`, `cancelled` o `failed`;
* progresso e risultati dell'ultima run completata.

Quando un input cambia durante una simulazione, terminare il Worker e ignorare messaggi con un run ID vecchio. Non aggiornare il grafico a ogni percorso: aggiornare a ogni batch.

### Web Worker e trasferimento dei buffer

Un Web Worker evita di bloccare il main thread, ma non rende gratis il calcolo:

* il Worker non puo' aggiornare direttamente React o il DOM;
* `postMessage` senza transfer list copia i buffer e puo' consumare molta memoria;
* con transfer list il buffer cambia proprietario e il mittente non puo' piu' usarlo;
* un loop sincrono molto lungo non puo' ricevere messaggi di cancellazione;
* eseguire batch limitati e pubblicare progresso tra un batch e l'altro.

### Dati statici e caching

Studiare `fetch`, `ArrayBuffer`, `DataView`, Cache-Control, compressione Brotli/gzip e cache del browser. Il manifest deve essere piccolo e caricato subito; la matrice di rendimenti va caricata solo dopo scelta di frequenza e valuta.

Non usare un parser Parquet nel browser per questa prima versione. Il vantaggio di compressione non compensa la complessita' quando un file binario `Float32` ha uno schema semplice e noto.

### Grafici con uPlot

uPlot e' adatto a serie temporali dense. Principi pratici:

* passare solo percentili e al massimo 50 percorsi individuali;
* non creare un grafico per ogni simulazione;
* mantenere dimensioni stabili del contenitore;
* aggiornare i dati del grafico dopo ogni batch, non per ogni punto;
* mostrare il rapporto di leva solo quando la leva e' attiva.

## 8. Costi Computazionali e Memoria

Definizioni:

* $N$: numero di percorsi;
* $T$: periodi per percorso;
* $A$: asset, con $A \le 8$.

### Complessita' principale

Il portfolio loop costa approssimativamente:

$$
O(N \times T \times A)
$$

Per Student's $t$, la fattorizzazione di Cholesky della matrice $A \times A$ costa $O(A^3)$ una sola volta per run. Generare shock correlati costa circa $O(N \times T \times A^2)$; con otto asset e' accettabile, ma cresce rapidamente con molti asset.

Per Markov, il costo aggiuntivo per periodo e' piccolo: campionare uno stato e una riga compatibile. La classificazione dei regimi e la stima della matrice di transizione avvengono una volta per configurazione dati.

### Budget del progetto

Il limite e':

$$
N \times T \le 10{,}000{,}000
$$

Esempi:

| Frequenza e orizzonte | Periodi $T$ | Percorsi massimi dal budget |
| --- | ---: | ---: |
| 30 anni mensili | 360 | 27.777 |
| 10 anni mensili | 120 | 50.000, limitati dal massimo assoluto |
| 30 anni settimanali | 1.560 | 6.410 |
| 10 anni settimanali | 520 | 19.230 |

Un `Float32Array` con 10 milioni di valori occupa circa 40 MB. Memorizzare inoltre tutte le posizioni, debiti e basi di costo per ogni percorso moltiplicherebbe il consumo. Per questo il Worker deve elaborare batch, trattenere metriche terminali per tutti i percorsi e dettagli completi solo per 50 percorsi.

### Cosa misurare

Usare gli strumenti Performance del browser per misurare:

* tempo totale della run e tempo per batch;
* memoria del Worker e del main thread;
* tempo di caricamento e decompressione dei dati;
* frame persi mentre il grafico si aggiorna;
* differenza tra dati mensili e settimanali;
* effetto di leva, tasse e ribilanciamento sul tempo per periodo.

Misurare prima di ottimizzare. Il primo collo di bottiglia puo' essere il rendering, il trasferimento dei buffer o le allocazioni, non la formula Monte Carlo.

## 9. Test, Validazione e Sicurezza Numerica

### Test unitari indispensabili

Ogni test usa input piccoli, seed fisso e risultati calcolabili a mano:

* un asset, nessun costo, nessuna tassa;
* contributo a fine periodo;
* acquisto e vendita con costo medio;
* perdita che compensa un guadagno futuro;
* ribilanciamento temporale e a banda;
* costo fisso e percentuale;
* interesse sul debito;
* margin call, deleveraging e insolvenza;
* righe bootstrap allineate;
* riproducibilita' dello stesso seed;
* matrice corretta da Higham e Cholesky valida.

### Test statistici

I test statistici non devono pretendere uguaglianza esatta. Verificano che, su molti percorsi:

* media e volatilita' simulate siano vicine ai parametri di input;
* correlazioni simulate siano vicine a quelle richieste;
* una Student's $t$ con $\nu$ piccolo mostri code piu' pesanti di una normale;
* il bootstrap emetta solo righe storiche complete;
* le frequenze delle transizioni Markov si avvicinino alla matrice $P$.

### Tolleranze e casi limite

Studiare floating point IEEE-754, `NaN`, `Infinity`, confronto con epsilon e ordine delle operazioni. Gestire esplicitamente:

* pesi che non sommano a uno o alla gross exposure scelta;
* input negativi dove non consentiti;
* tasso di tassa oltre $100\%$;
* covarianza non valida;
* dati insufficienti;
* prezzo o equity non positivi;
* IRR senza soluzione unica;
* costi che rendono una transazione economicamente impossibile.

### Validazione esterna

Prima di fidarsi della UI, confrontare piccole simulazioni con un foglio di calcolo o uno script Python indipendente. Confrontare il comportamento, non solo il valore finale: ogni periodo deve avere lo stesso debito, basis, tassa, costo e valore.

## 10. Percorso Consigliato di Apprendimento

1. Implementare e verificare capitalizzazione, pesi e contributi senza casualita'.
2. Studiare rendimenti semplici, log-rendimenti, media, varianza e percentili.
3. Implementare il bootstrap con un solo asset, poi con piu' asset su righe allineate.
4. Studiare matrici, Cholesky e generazione di normali correlate.
5. Implementare Student's $t$ e confrontarla con la normale su dati sintetici.
6. Aggiungere Worker, TypedArray, batching e cancellazione.
7. Aggiungere ribilanciamento, cost basis, tasse, costi e leva uno alla volta, con test a mano per ogni regola.
8. Studiare drawdown, Sharpe, IRR e real returns; aggiungere metriche solo dopo aver definito la loro convenzione.
9. Implementare la pagina educativa che esplicita ipotesi, limiti e formule.
10. Studiare e aggiungere Markov solo quando i motori esistenti sono testati e confrontati con risultati indipendenti.

## 11. Fonti e Parole Chiave da Cercare

Per studiare, cercare documentazione primaria, testi universitari o note tecniche su:

* "Monte Carlo simulation confidence intervals and standard error";
* "historical bootstrap portfolio returns limitations";
* "multivariate Student t distribution scale matrix covariance";
* "Higham nearest correlation matrix";
* "Cholesky decomposition covariance simulation";
* "money weighted return IRR versus time weighted return";
* "portfolio rebalancing transaction costs tax lot average cost basis";
* "maintenance margin gross exposure equity debt";
* "Markov chain transition matrix stationary distribution";
* "hidden Markov model market regimes overfitting";
* "Web Workers transferable ArrayBuffer TypedArray";
* "uPlot performance large time series";
* "JavaScript IEEE 754 floating point numerical stability".

L'obiettivo non e' usare il modello piu' sofisticato. E' capire cosa ogni modello assume, rendere tali ipotesi visibili nell'interfaccia e verificare che il codice implementi esattamente quelle regole.
