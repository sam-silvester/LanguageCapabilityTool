-- =====================================================================================
-- ACE General Query: one query, every variation
-- Data: family_history_operations_prd.user_rms_bronze
--
-- HOW TO USE
--   Change the values in the SETTINGS block just below, run, read the result.
--   No lines to comment in or out. A misspelled filter value returns no rows.
--
-- VARIATIONS (each one is a single setting; combine them freely)
--
--   What you want                                    Setting
--   -----------------------------------------------  -------------------------------------------
--   Top tier, as the uploaded file runs it           tier = 'top_any'
--   "Targeting top-tier" per its comments            tier = 'top_only'      (top AND NOT mid)
--   "Targeting mid-tier" per its comments            tier = 'mid_only'      (mid AND NOT top)
--   Any group with a mid-tier record type            tier = 'mid_any'
--   Top or mid                                       tier = 'top_or_mid'
--   No tier filter                                   tier = 'any'
--
--   Unindexed images (as uploaded)                   index_status = 'unindexed'
--   Indexed images                                   index_status = 'indexed'
--   Both                                             index_status = 'any'
--
--   Mixed-language pool (as uploaded)                languages = array('en','es','pt','de','fr','it','nl'), language_mix = 'mixed_ok'
--   Single language                                  languages = array('de')
--   Several languages, none mixed on one group       languages = array('en','es',...), language_mix = 'one_per_group'
--   Every language                                   languages = array('*')
--
--   Any classification (as uploaded)                 classification = 'any'
--   Natural language (NON_FORM, FITB paragraph)      classification = 'natural_language'
--   Not natural language (forms, tables, indexes)    classification = 'form'
--
--   Ignore full-text processing (as uploaded)        full_text = 'any'
--   Not yet processed for full text                  full_text = 'not_processed'
--   Already processed for full text                  full_text = 'processed'
--
--   Temple excluded, PIPA counted (as uploaded)      pipa = 'include'
--   Leave PIPA out too                               pipa = 'exclude'
--   Only the PIPA groups                             pipa = 'only'
--
--   Leave out a country                              exclude_place_like = '%Canada%'
--   Only one country (added)                         only_place_like = '%Honduras%'
--   Only certain record types (added)                record_types = array('100599', '124277')
--   Only certain groups                              only_groups = array('107466019', '107466015')
--
--   One grand total                                  detail = 'total'
--   Totals by language                               detail = 'language'
--   Totals by language and record type (original)    detail = 'record_type'
--   The list of groups                               detail = 'group'
--
-- CHANGES FROM THE UPLOADED FILE
--   * Tables carry the full family_history_operations_prd.user_rms_bronze name.
--   * Language and record-type lists are sorted before grouping, so "en, es" and
--     "es, en" can no longer come back as two separate rows.
--   * Record types outside the top-tier name list show their id ("Mid-tier type 100599")
--     in place of "Unknown".
--   * 130075 was in the mid-tier list twice; it is listed once here.
-- =====================================================================================

WITH
-- ============================== SETTINGS: edit here ==============================
settings AS (
  SELECT
    'top_any'                                    AS tier,                -- top_any | top_only | mid_only | mid_any | top_or_mid | any
    'unindexed'                                  AS index_status,        -- unindexed | indexed | any
    array('en','es','pt','de','fr','it','nl')    AS languages,           -- language codes, or array('*') for every language
    'mixed_ok'                                   AS language_mix,        -- mixed_ok | one_per_group
    'any'                                        AS classification,      -- any | natural_language | form
    'any'                                        AS full_text,           -- any | not_processed | processed
    'include'                                    AS pipa,                -- include | exclude | only
    CAST(NULL AS STRING)                         AS exclude_place_like,  -- e.g. '%Canada%'   (NULL = leave nothing out)
    CAST(NULL AS STRING)                         AS only_place_like,     -- e.g. '%Honduras%' (NULL = everywhere)
    array('*')                                   AS record_types,        -- e.g. array('100599','124277'), or array('*') for all
    array('*')                                   AS only_groups,         -- e.g. array('107466019','107466015'), or array('*') for all
    'record_type'                                AS detail               -- total | language | record_type | group
),
-- =================================================================================

-- The settings again, plus a one-line label that is written on every result row,
-- so a downloaded file says what it counted.
s AS (
  SELECT
    settings.*,
    concat_ws('; ',
      concat('tier=', tier),
      concat('index=', index_status),
      concat('languages=', array_join(languages, ',')),
      concat('mix=', language_mix),
      concat('classification=', classification),
      concat('full_text=', full_text),
      concat('pipa=', pipa),
      concat('exclude_place=', exclude_place_like),
      concat('only_place=', only_place_like),
      concat('record_types=', array_join(record_types, ',')),
      concat('groups=', CASE WHEN array_contains(only_groups, '*') THEN '*' ELSE concat(CAST(size(only_groups) AS STRING), ' listed') END)
    ) AS variation
  FROM settings
),

-- Record types: which tier each record_type_id belongs to, and its name where the
-- General Query had one. Same two lists as the original (top tier 251 ids, mid tier 856 ids).
record_type_ref AS (
  SELECT t.record_type_id, 'TOP' AS tier, t.record_type_name
  FROM VALUES
    ('101383', 'Marriage Supplements'),
    ('103612', 'Baptism Records'),
    ('103940', 'Betrothal Records'),
    ('103979', 'Birth Records'),
    ('104497', 'Burial Records'),
    ('104727', 'Marriage Records'),
    ('104742', 'Marriage Proclamation Records'),
    ('104744', 'Marriage Notifications'),
    ('104898', 'Death Records'),
    ('104929', 'Delayed Birth Records'),
    ('104935', 'Delayed Burials'),
    ('105027', 'Civil Registrations'),
    ('113889', 'Marriage Contracts'),
    ('114490', 'Christening Records'),
    ('114513', 'Marriage Licenses'),
    ('118367', 'Marriage Settlement Records'),
    ('118627', 'Engagement Records'),
    ('122933', 'Adult Christening Records'),
    ('122949', 'Legitimation Records'),
    ('122950', 'Marriage Banns'),
    ('123138', 'Marriage Investigation Records'),
    ('123206', 'Adult Baptism Records'),
    ('123241', 'Death Certificate Applications'),
    ('123264', 'Armed Service Burial Records'),
    ('123291', 'Birth Record Applications'),
    ('123292', 'Birth Certificate Applications'),
    ('123293', 'Birth at Sea Records'),
    ('123333', 'Burial Applications'),
    ('123335', 'Burial Permits'),
    ('123338', 'Burial at Sea Records'),
    ('123357', 'Cemetery Plot Records'),
    ('123358', 'Cemetery Records'),
    ('123359', 'Gravestone Transcription Records'),
    ('123377', 'Certified Marriage Records'),
    ('123443', 'Columbarium Records'),
    ('123466', 'Consulate Birth Records'),
    ('123470', 'Convert Baptism Records'),
    ('123473', 'Coroner Records'),
    ('123474', 'Coroner Inquest Records'),
    ('123480', 'Corrections to Death Certificate'),
    ('123481', 'Corrections to Death Record'),
    ('123499', 'Crematorium Records'),
    ('123521', 'Death at Sea Records'),
    ('123522', 'Prison Camp Death Records'),
    ('123525', 'Battlefield Death Records'),
    ('123560', 'Delayed Baptism Records'),
    ('123561', 'Delayed Birth Certificates'),
    ('123563', 'Delayed Death Records'),
    ('123564', 'Delayed Marriage Records'),
    ('123590', 'Exhumation Applications'),
    ('123591', 'Marriage Dispensation Records'),
    ('123614', 'Dowry Records'),
    ('123630', 'Emergency Baptism Records'),
    ('123671', 'Exhumation Records'),
    ('123689', 'Fetal Death Certificates'),
    ('123716', 'Foreign Birth Records'),
    ('123724', 'Funeral Home Records'),
    ('123726', 'Funeral Programs'),
    ('123751', 'Grave Condition Reports'),
    ('123753', 'Grave Registers'),
    ('123833', 'Marriage Banns Record Indexes'),
    ('123837', 'Baptism Record Indexes'),
    ('123841', 'Birth Record Indexes'),
    ('123848', 'Burial Record Indexes'),
    ('123853', 'Cemetery Record Indexes'),
    ('123859', 'Crematorium Record Indexes'),
    ('123860', 'Death Record Indexes'),
    ('123881', 'Delayed Birth Indexes'),
    ('123931', 'Marriage Record Indexes'),
    ('123973', 'Purchased Grave Register Indexes'),
    ('123984', 'War Grave Record Indexes'),
    ('123994', 'Infant Baptism Records'),
    ('124092', 'Marriage Abstracts'),
    ('124097', 'Marriage Applications'),
    ('124107', 'Marriage Objection Records'),
    ('124108', 'Marriage Quarterly Reports'),
    ('124110', 'Marriage at Sea Records'),
    ('124113', 'Mausoleum Records'),
    ('124127', 'Military Cemetery Records'),
    ('124129', 'Military Death Records'),
    ('124171', 'Negro Birth Records'),
    ('124258', 'Plot Maps'),
    ('124294', 'Purchased Grave Registers'),
    ('124322', 'Reconstructed Baptism Records'),
    ('124324', 'Reconstructed Marriage Records'),
    ('124330', 'Birth Registers for Vaccinations'),
    ('124383', 'Social Security Death Indexes'),
    ('124445', 'War Grave Records'),
    ('126273', 'Coroner Actions Records'),
    ('126314', 'Baptism Registers'),
    ('126315', 'Baptism Certificates'),
    ('126321', 'Birth Affidavits'),
    ('126322', 'Birth Correction Records'),
    ('126349', 'Cemetery Land Deeds'),
    ('126374', 'Marriage Registers'),
    ('126508', 'Funeral Home Record Indexes'),
    ('126509', 'Funeral Sermon Records'),
    ('126542', 'Hospital Birth Records'),
    ('126638', 'Marriage Consent Records'),
    ('126653', 'Midwife Records'),
    ('126663', 'Ministers Marriage Returns'),
    ('126683', 'Necrology Records'),
    ('126755', 'Physician Birth Records'),
    ('126778', 'Prenuptial Agreement Records'),
    ('126811', 'Death Registers'),
    ('126812', 'Death at Sea Registers'),
    ('126828', 'Tombstone Removal Records'),
    ('126829', 'Removal Transit Permits'),
    ('126869', 'Social Security Death Records'),
    ('126901', 'Town Burial Registers'),
    ('126936', 'War Veteran Grave Records'),
    ('126950', 'Workhouse Birth Registers'),
    ('126951', 'Workhouse Death Registers'),
    ('127074', 'Marriage Affidavits'),
    ('127075', 'Marriage Bonds'),
    ('127079', 'Death Certificates'),
    ('127092', 'Cremation Records'),
    ('127280', 'Birth Certificates'),
    ('127546', 'Illegitimate Birth Records'),
    ('127549', 'Marriage Certificates'),
    ('127550', 'Marriage Certificate Indexes'),
    ('127551', 'Marriage Contract Indexes'),
    ('127565', 'Baptism Correction Records'),
    ('127576', 'Religious Death Records'),
    ('127577', 'Religious Marriage Records'),
    ('127587', 'Marriage Correction Records'),
    ('127588', 'Marriage License Applications'),
    ('127589', 'Marriage License Indexes'),
    ('127593', 'Mortician Records'),
    ('127652', 'Burial Registers'),
    ('127654', 'Remains Transfer Files'),
    ('127680', 'Religious Marriage Investigation Files'),
    ('127681', 'Religious Marriage Correction Records'),
    ('127682', 'Religious Marriage Correction Files'),
    ('127683', 'Religious Marriage Record Indexes'),
    ('127684', 'Baptism Correction Files'),
    ('127685', 'Delayed Baptism Files'),
    ('127686', 'Religious Death Record Indexes'),
    ('127737', 'Negative Baptism Certificates'),
    ('129061', 'Burial Cards'),
    ('129062', 'Grave Cards'),
    ('129063', 'Reinterment Records'),
    ('129064', 'Reinterment Applications'),
    ('129092', 'Burial Niche Records'),
    ('129427', 'Four-year Death Indexes'),
    ('129428', 'Ten-year Death Indexes'),
    ('129429', 'Death Supplements'),
    ('129430', 'Foundling Baptism Records'),
    ('129432', 'Four-year Birth Indexes'),
    ('129433', 'Ten-year Birth Indexes'),
    ('129434', 'Birth Supplements'),
    ('129437', 'Hospital Baptism Records'),
    ('129438', 'Marriage Banns Supplements'),
    ('129439', 'Marriage Banns Ten-year Indexes'),
    ('129440', 'Four-year Marriage Indexes'),
    ('129441', 'Ten-year Marriage Indexes'),
    ('129443', 'Death Away from Home Records'),
    ('129451', 'Grave Owner Directories'),
    ('129453', 'Grave Titles'),
    ('129454', 'Cemetery Plot Leases'),
    ('129466', 'Religious Marriage Parental Consent Records'),
    ('129467', 'Religious Marriage Exhortation Records'),
    ('129470', 'Paternity Challenge Records'),
    ('129471', 'Grave Owner Indexes'),
    ('129533', 'Civil Union Records'),
    ('129536', 'Autopsy Reports'),
    ('129550', 'Delayed Marriage Files'),
    ('129551', 'Delayed Birth Files'),
    ('129552', 'Delayed Death Files'),
    ('129566', 'Baptism Record Extracts'),
    ('129568', 'Citizen Marriage Records'),
    ('129570', 'Citizen Death Records'),
    ('129572', 'Death Record Extracts'),
    ('129573', 'Hospital Death Records'),
    ('129602', 'Nuptial Blessing Records'),
    ('129608', 'Baptism Supplements'),
    ('129613', 'Marriage Banns Files'),
    ('129707', 'Consulate Marriage Records'),
    ('129708', 'Consulate Death Records'),
    ('129710', 'Burial Certificates'),
    ('129749', 'Live Birth Declarations'),
    ('129755', 'Medical Death Certificates'),
    ('129959', 'Birth Record Replacements'),
    ('129960', 'Birth Notifications'),
    ('129961', 'Death Notifications'),
    ('129968', 'Birth Index Cards'),
    ('129969', 'Marriage Index Cards'),
    ('129970', 'Death Index Cards'),
    ('130028', 'Point of Death Marriage Records'),
    ('130029', 'Collective Wedding Records'),
    ('130030', 'Civil Records of Religious Marriages'),
    ('130079', 'Reconstructed Ecclesiastical Death Records'),
    ('130080', 'Reconstructed Religious Marriage Records'),
    ('130081', 'Baptism Record Transcriptions'),
    ('130082', 'Religious Death Record Transcriptions'),
    ('130083', 'Religious Marriage Record Transcriptions'),
    ('130084', 'Religious Marriage Notifications'),
    ('130103', 'Coroner Record Indexes'),
    ('130117', 'Cemetery Files'),
    ('130141', 'Religious Marriage Registers'),
    ('130142', 'Religious Death Registers'),
    ('130148', 'Birth Correction Supplements'),
    ('130153', 'Foundling Birth Records'),
    ('130656', 'Birth Registers'),
    ('130658', 'Marriage Registration Applications'),
    ('130659', 'Death Registration Applications'),
    ('130920', 'Military Death Cards'),
    ('130935', 'Religious Marriage Bonds'),
    ('130937', 'Prayer Cards'),
    ('130941', 'Marriage Proclamation Supplements'),
    ('130942', 'Marriage Proclamation Record Indexes'),
    ('130943', 'Ten-year Marriage Proclamation Indexes'),
    ('130945', 'Church Death Correction Records'),
    ('130956', 'Religious Death Supplements'),
    ('130957', 'Remains Transfer Records'),
    ('130958', 'Cemetery Payment Records'),
    ('131007', 'Burial Register Indexes'),
    ('131011', 'Grave Records'),
    ('131114', 'Birth Reports'),
    ('131115', 'Marriage Reports'),
    ('131116', 'Death Reports'),
    ('131193', 'Legitimation Supplements'),
    ('131201', 'Religious Death Correction Files'),
    ('131219', 'Non-resident Citizen Baptism Records'),
    ('131220', 'Non-citizen Resident Baptism Records'),
    ('131221', 'Non-resident Citizen Marriage Records'),
    ('131222', 'Non-citizen Resident Marriage Records'),
    ('131223', 'Non-resident Citizen Death Records'),
    ('131224', 'Non-citizen Resident Death Records'),
    ('131228', 'Birth and Baptism Records'),
    ('131342', 'Declared Dead Records'),
    ('131345', 'Delayed Religious Marriage Files'),
    ('131346', 'Delayed Religious Death Files'),
    ('131347', 'Baptism Licenses'),
    ('131353', 'Death Record Replacements'),
    ('131354', 'Marriage Record Replacements'),
    ('131416', 'Foreign Marriage Records'),
    ('131444', 'Marriage License Supplements'),
    ('131449', 'Gravestone Images'),
    ('131450', 'Marriage Notification Supplements'),
    ('131571', 'Religious Death Record Extracts'),
    ('131573', 'Birth Abstracts'),
    ('131574', 'Death Abstracts'),
    ('131575', 'Abbreviated Death Indexes'),
    ('131576', 'Abbreviated Birth Indexes'),
    ('131586', 'Customary Marriage Registrations'),
    ('131605', 'Enslaved People Baptism Records'),
    ('131606', 'Enslaved People Baptism Record Indexes'),
    ('131631', 'Religious Marriage Index Cards'),
    ('131632', 'Religious Death Index Cards'),
    ('131633', 'Baptism Index Cards')
    AS t(record_type_id, record_type_name)
  UNION ALL
  SELECT m.record_type_id, 'MID' AS tier, CAST(NULL AS STRING) AS record_type_name
  FROM VALUES
    ('123793'), ('123794'), ('126309'), ('126501'), ('126725'), ('126726'), ('127076'), ('127119'), ('127545'), ('127548'), ('129081'), ('129095'),
    ('129563'), ('130031'), ('130032'), ('130962'), ('131227'), ('131578'), ('122920'), ('122921'), ('122923'), ('123279'), ('123286'), ('123290'),
    ('123682'), ('123685'), ('123731'), ('123779'), ('123839'), ('123903'), ('126393'), ('126439'), ('126481'), ('126563'), ('126625'), ('126706'),
    ('127908'), ('129469'), ('130946'), ('131124'), ('131125'), ('131126'), ('131336'), ('131489'), ('131596'), ('135003'), ('104611'), ('104808'),
    ('123013'), ('123014'), ('123110'), ('123168'), ('123240'), ('123350'), ('123352'), ('123375'), ('123442'), ('123527'), ('123617'), ('123641'),
    ('123886'), ('123933'), ('124114'), ('124130'), ('124131'), ('124133'), ('124134'), ('124159'), ('124242'), ('124372'), ('124441'), ('126311'),
    ('126348'), ('126386'), ('126431'), ('126655'), ('126656'), ('126657'), ('126659'), ('126660'), ('126701'), ('126702'), ('126703'), ('126809'),
    ('126870'), ('126926'), ('127016'), ('127017'), ('127571'), ('127592'), ('127621'), ('129058'), ('129087'), ('129089'), ('129446'), ('129537'),
    ('129977'), ('130036'), ('130037'), ('130038'), ('130087'), ('130088'), ('130089'), ('131006'), ('131010'), ('131343'), ('131439'), ('131549'),
    ('103793'), ('119145'), ('123365'), ('123407'), ('123635'), ('123804'), ('123937'), ('124078'), ('124356'), ('124384'), ('124464'), ('124467'),
    ('126448'), ('126511'), ('126513'), ('126619'), ('126942'), ('127039'), ('129747'), ('130965'), ('130988'), ('131590'), ('131597'), ('131616'),
    ('100595'), ('100628'), ('100687'), ('123215'), ('123218'), ('123220'), ('123222'), ('123223'), ('123242'), ('123247'), ('123370'), ('123408'),
    ('123411'), ('123412'), ('123441'), ('123632'), ('123673'), ('123694'), ('123696'), ('123699'), ('123798'), ('123799'), ('123827'), ('123854'),
    ('123867'), ('123940'), ('123941'), ('123974'), ('124081'), ('124123'), ('124132'), ('124137'), ('124162'), ('124164'), ('124180'), ('124245'),
    ('124327'), ('124342'), ('124432'), ('124442'), ('126300'), ('126327'), ('126404'), ('126415'), ('126434'), ('126453'), ('126492'), ('126548'),
    ('126549'), ('126681'), ('127023'), ('127030'), ('127069'), ('127077'), ('127904'), ('129529'), ('129530'), ('129535'), ('129751'), ('129971'),
    ('130034'), ('130129'), ('130662'), ('130708'), ('130715'), ('130940'), ('131113'), ('131195'), ('131455'), ('131476'), ('131491'), ('131492'),
    ('131572'), ('131587'), ('131602'), ('130075'), ('123231'), ('123230'), ('123634'), ('124331'), ('124361'), ('126339'), ('126340'), ('126532'),
    ('126628'), ('126662'), ('126698'), ('126748'), ('126800'), ('127018'), ('127081'), ('127083'), ('127084'), ('127086'), ('127102'), ('127103'),
    ('127111'), ('127118'), ('127583'), ('127590'), ('129418'), ('130092'), ('130936'), ('130938'), ('130954'), ('131461'), ('131580'), ('104700'),
    ('116570'), ('122954'), ('122958'), ('123143'), ('123227'), ('123228'), ('123245'), ('123372'), ('123478'), ('123483'), ('123485'), ('123513'),
    ('123602'), ('123639'), ('123718'), ('123723'), ('123738'), ('123904'), ('123920'), ('123985'), ('123999'), ('124070'), ('124151'), ('124177'),
    ('124197'), ('124208'), ('124216'), ('124222'), ('124225'), ('124226'), ('124227'), ('124293'), ('124355'), ('124393'), ('124408'), ('124410'),
    ('124411'), ('124423'), ('124424'), ('124425'), ('124451'), ('124454'), ('124465'), ('126289'), ('126296'), ('126328'), ('126375'), ('126388'),
    ('126395'), ('126400'), ('126405'), ('126422'), ('126471'), ('126479'), ('126483'), ('126516'), ('126517'), ('126534'), ('126535'), ('126546'),
    ('126620'), ('126651'), ('126671'), ('126675'), ('126685'), ('126705'), ('126715'), ('126716'), ('126724'), ('126730'), ('126746'), ('126763'),
    ('126766'), ('126768'), ('126770'), ('126774'), ('126780'), ('126788'), ('126798'), ('126801'), ('126840'), ('126847'), ('126851'), ('126857'),
    ('126879'), ('126919'), ('127027'), ('127120'), ('127578'), ('127688'), ('127885'), ('127900'), ('129042'), ('129046'), ('129052'), ('129091'),
    ('129093'), ('129422'), ('129425'), ('129452'), ('129456'), ('129457'), ('129458'), ('129460'), ('129468'), ('129472'), ('129538'), ('129543'),
    ('129553'), ('129567'), ('129754'), ('129958'), ('129962'), ('129963'), ('129964'), ('130040'), ('130041'), ('130090'), ('130097'), ('130136'),
    ('130137'), ('130717'), ('130718'), ('130759'), ('130760'), ('130959'), ('130964'), ('130966'), ('131008'), ('131009'), ('131099'), ('131118'),
    ('131119'), ('131120'), ('131121'), ('131127'), ('131129'), ('131417'), ('131419'), ('131421'), ('131440'), ('131448'), ('131458'), ('131463'),
    ('131471'), ('131473'), ('131474'), ('131475'), ('131550'), ('131579'), ('131582'), ('131588'), ('131600'), ('131642'), ('135000'), ('122935'),
    ('130077'), ('122936'), ('100599'), ('100997'), ('103690'), ('103772'), ('104616'), ('104704'), ('104791'), ('122797'), ('122948'), ('123170'),
    ('123179'), ('123193'), ('123194'), ('123196'), ('123204'), ('123207'), ('123214'), ('123232'), ('123233'), ('123255'), ('123256'), ('123282'),
    ('123288'), ('123300'), ('123310'), ('123330'), ('123349'), ('123381'), ('123387'), ('123417'), ('123429'), ('123436'), ('123453'), ('123454'),
    ('123468'), ('123486'), ('123495'), ('123497'), ('123504'), ('123509'), ('123529'), ('123545'), ('123546'), ('123548'), ('123549'), ('123550'),
    ('123551'), ('123554'), ('123555'), ('123557'), ('123558'), ('123569'), ('123571'), ('123599'), ('123609'), ('123628'), ('123646'), ('123647'),
    ('123648'), ('123649'), ('123651'), ('123660'), ('123665'), ('123667'), ('123668'), ('123706'), ('123715'), ('123735'), ('123744'), ('123745'),
    ('123746'), ('123756'), ('123762'), ('123763'), ('123764'), ('123767'), ('123769'), ('123772'), ('123784'), ('123786'), ('123787'), ('123788'),
    ('123801'), ('123811'), ('123814'), ('123818'), ('123826'), ('123829'), ('123845'), ('123855'), ('123856'), ('123857'), ('123870'), ('123872'),
    ('123874'), ('123882'), ('123883'), ('123884'), ('123890'), ('123892'), ('123893'), ('123896'), ('123901'), ('123913'), ('123915'), ('123916'),
    ('123918'), ('123921'), ('123923'), ('123924'), ('123925'), ('123926'), ('123935'), ('123954'), ('123955'), ('123958'), ('123963'), ('123968'),
    ('123970'), ('123976'), ('123978'), ('123981'), ('123986'), ('123989'), ('123997'), ('124006'), ('124023'), ('124025'), ('124026'), ('124030'),
    ('124032'), ('124034'), ('124035'), ('124036'), ('124038'), ('124039'), ('124041'), ('124044'), ('124045'), ('124056'), ('124072'), ('124082'),
    ('124086'), ('124152'), ('124182'), ('124190'), ('124201'), ('124211'), ('124255'), ('124256'), ('124269'), ('124277'), ('124281'), ('124289'),
    ('124304'), ('124308'), ('124311'), ('124314'), ('124317'), ('124375'), ('124378'), ('124392'), ('124404'), ('124415'), ('124416'), ('124426'),
    ('124427'), ('124439'), ('124449'), ('124456'), ('124457'), ('124462'), ('126272'), ('126274'), ('126275'), ('126276'), ('126277'), ('126283'),
    ('126284'), ('126287'), ('126288'), ('126291'), ('126299'), ('126306'), ('126317'), ('126318'), ('126319'), ('126335'), ('126344'), ('126345'),
    ('126362'), ('126369'), ('126370'), ('126379'), ('126380'), ('126391'), ('126392'), ('126403'), ('126408'), ('126409'), ('126410'), ('126414'),
    ('126416'), ('126417'), ('126420'), ('126421'), ('126435'), ('126438'), ('126446'), ('126473'), ('126475'), ('126477'), ('126485'), ('126488'),
    ('126489'), ('126499'), ('126504'), ('126505'), ('126518'), ('126519'), ('126521'), ('126522'), ('126523'), ('126525'), ('126527'), ('126528'),
    ('126529'), ('126530'), ('126541'), ('126556'), ('126557'), ('126560'), ('126561'), ('126566'), ('126570'), ('126573'), ('126578'), ('126581'),
    ('126593'), ('126603'), ('126605'), ('126617'), ('126618'), ('126626'), ('126636'), ('126643'), ('126661'), ('126672'), ('126678'), ('126690'),
    ('126691'), ('126717'), ('126753'), ('126756'), ('126784'), ('126785'), ('126789'), ('126802'), ('126819'), ('126830'), ('126831'), ('126845'),
    ('126848'), ('126860'), ('126864'), ('126865'), ('126877'), ('126895'), ('126900'), ('126915'), ('126940'), ('126946'), ('127010'), ('127013'),
    ('127014'), ('127026'), ('127073'), ('127110'), ('127573'), ('127579'), ('127580'), ('127581'), ('127584'), ('127676'), ('127738'), ('127905'),
    ('129048'), ('129055'), ('129088'), ('129419'), ('129442'), ('129461'), ('129462'), ('129548'), ('129560'), ('129709'), ('129752'), ('129930'),
    ('129966'), ('130035'), ('130086'), ('130096'), ('130119'), ('130657'), ('130661'), ('130921'), ('130986'), ('130987'), ('131112'), ('131196'),
    ('131249'), ('131333'), ('131350'), ('131423'), ('131424'), ('131443'), ('131446'), ('131454'), ('131477'), ('131601'), ('131630'), ('123346'),
    ('123404'), ('129464'), ('105025'), ('123433'), ('123434'), ('130076'), ('123435'), ('126382'), ('123451'), ('124172'), ('123471'), ('129043'),
    ('123676'), ('123457'), ('105041'), ('131462'), ('131247'), ('107609'), ('122944'), ('129753'), ('123780'), ('126587'), ('124146'), ('124147'),
    ('123010'), ('126544'), ('124135'), ('130934'), ('124046'), ('131199'), ('129532'), ('126667'), ('126673'), ('123017'), ('124194'), ('106833'),
    ('126718'), ('124206'), ('126767'), ('130101'), ('124251'), ('124252'), ('124253'), ('126723'), ('124262'), ('124261'), ('130955'), ('126692'),
    ('123391'), ('129549'), ('129557'), ('123393'), ('129555'), ('129558'), ('129559'), ('130118'), ('130960'), ('131459'), ('123541'), ('129554'),
    ('123680'), ('127031'), ('123396'), ('123398'), ('123397'), ('126824'), ('130078'), ('124117'), ('126925'), ('129544'), ('130143'), ('130144'),
    ('130919'), ('130923'), ('131242'), ('131243'), ('135006'), ('131472'), ('129057'), ('130209'), ('126537'), ('123400'), ('123401'), ('130140'),
    ('124279'), ('131246'), ('123979'), ('129547'), ('131230'), ('126591'), ('126882'), ('124370'), ('124401'), ('124379'), ('126890'), ('126954'),
    ('126938'), ('126924'), ('100761'), ('104851'), ('116198'), ('123201'), ('123202'), ('123321'), ('123740'), ('124365'), ('124402'), ('124412'),
    ('124466'), ('126310'), ('126832'), ('126850'), ('126884'), ('126888'), ('126889'), ('127656'), ('127886'), ('127890'), ('129415'), ('131244'),
    ('131445'), ('131548'), ('129957'), ('130716'), ('124418'), ('124420'), ('124421'), ('126899'), ('131581'), ('123805'), ('122960'), ('126451'),
    ('126933'), ('126934'), ('127015'), ('131411')
    AS m(record_type_id)
),

-- Groups: the filters that never change (has images, natural groups).
grp AS (
  SELECT
    b.id,
    b.group_name,
    b.group_type,
    b.child_count,
    CASE
      WHEN COALESCE(b.indexed_child_count, 0) = 0 AND COALESCE(b.child_record_count, 0) = 0 THEN 'unindexed'
      WHEN b.indexed_child_count > 0 OR b.child_record_count > 0 THEN 'indexed'
      ELSE 'other'
    END AS index_status
  FROM family_history_operations_prd.user_rms_bronze.base b
  WHERE b.child_count > 0
    AND b.group_type IN ('DGS;NATURAL', 'NATURAL')
),

-- Languages on each group (NULL languages ignored, as in the original).
lang AS (
  SELECT
    l.id,
    array_sort(collect_set(l.language)) AS lang_arr,
    COUNT(DISTINCT l.language)          AS lang_count
  FROM family_history_operations_prd.user_rms_bronze.languages l
  WHERE l.language IS NOT NULL
  GROUP BY l.id
),

-- Record types on each group, and which tier lists they hit.
cov AS (
  SELECT
    c.id,
    count_if(r.tier = 'TOP') > 0 AS has_top,
    count_if(r.tier = 'MID') > 0 AS has_mid,
    count_if(c.place LIKE s.exclude_place_like) > 0 AS place_excluded,
    count_if(c.place LIKE s.only_place_like) > 0    AS place_included,
    array_sort(collect_set(CAST(c.record_type_id AS STRING))) AS record_type_ids,
    array_join(array_sort(collect_set(
      COALESCE(r.record_type_name,
               concat(CASE WHEN r.tier = 'MID' THEN 'Mid-tier type ' ELSE 'Other type ' END,
                      CAST(c.record_type_id AS STRING)))
    )), '; ') AS record_types
  FROM family_history_operations_prd.user_rms_bronze.coverages c
  CROSS JOIN s
  LEFT JOIN record_type_ref r
    ON r.record_type_id = CAST(c.record_type_id AS STRING)
  GROUP BY c.id
),

-- ACE image classification and full-text processing on each group.
cls AS (
  SELECT
    p.id,
    count_if(p.name = 'classification' AND p.type = 'ACE'
             AND p.value IN ('129486', '129477')) > 0                               AS has_natural_language,  -- FILL_IN_THE_BLANK_PARAGRAPH, NON_FORM
    count_if(p.name = 'classification' AND p.type = 'ACE'
             AND p.value IN ('129973', '129972', '129975', '129485', '129478')) > 0 AS has_form,              -- INDEX, KEY_VALUE, TABLE, MODERN, FORM
    count_if(p.name = 'processingCompleted' AND p.value LIKE 'TR%') > 0             AS full_text_done,
    array_join(array_sort(collect_set(
      CASE WHEN p.name = 'classification' AND p.type = 'ACE' THEN
        CASE p.value
          WHEN '129477' THEN 'NON_FORM'
          WHEN '129478' THEN 'FORM'
          WHEN '129513' THEN 'NORMAL'
          WHEN '129974' THEN 'ADMINISTRATIVE'
          WHEN '129516' THEN 'BLANK_PAGE'
          WHEN '129973' THEN 'INDEX'
          WHEN '129486' THEN 'FILL_IN_THE_BLANK_PARAGRAPH'
          WHEN '129972' THEN 'FILL_IN_THE_BLANK_KEY_VALUE'
          WHEN '129975' THEN 'TABLE'
          WHEN '129485' THEN 'FILL_IN_THE_BLANK_MODERN'
          ELSE 'Unknown'
        END
      END
    )), ', ') AS classifications
  FROM family_history_operations_prd.user_rms_bronze.properties p
  WHERE p.name IN ('classification', 'processingCompleted')
  GROUP BY p.id
),

-- Permissions on each group.
prm AS (
  SELECT
    m.id,
    count_if(m.permission = 'ThemisPrmTemple') > 0            AS has_temple,
    count_if(m.permission = 'ThemisPrmPIPA') > 0              AS has_pipa,
    array_join(array_sort(collect_set(m.permission)), ', ')   AS permissions
  FROM family_history_operations_prd.user_rms_bronze.permissions m
  GROUP BY m.id
),

-- Only shown when detail = 'group'.
phx AS (
  SELECT ph.id,
         array_join(array_sort(collect_set(CAST(ph.phoenix_acquisition_id AS STRING))), ', ') AS phoenix_ids
  FROM family_history_operations_prd.user_rms_bronze.phoenixacquisitionids ph
  GROUP BY ph.id
),
coll AS (
  SELECT ct.id,
         array_join(array_sort(collect_set(CAST(ct.collection_id AS STRING))), ', ') AS collection_ids
  FROM family_history_operations_prd.user_rms_bronze.counts ct
  GROUP BY ct.id
),

-- One row per group with every attribute the settings filter on.
profile AS (
  SELECT
    g.id,
    g.group_name,
    g.group_type,
    g.child_count,
    g.index_status,
    l.lang_arr,
    COALESCE(l.lang_count, 0)                         AS lang_count,
    COALESCE(array_join(l.lang_arr, ', '), '(none)')  AS langs,
    COALESCE(c.has_top, false)                        AS has_top,
    COALESCE(c.has_mid, false)                        AS has_mid,
    COALESCE(c.place_excluded, false)                 AS place_excluded,
    COALESCE(c.place_included, false)                 AS place_included,
    c.record_type_ids,
    COALESCE(c.record_types, '(none)')                AS record_types,
    COALESCE(k.has_natural_language, false)           AS has_natural_language,
    COALESCE(k.has_form, false)                       AS has_form,
    COALESCE(k.full_text_done, false)                 AS full_text_done,
    k.classifications,
    COALESCE(m.has_temple, false)                     AS has_temple,
    COALESCE(m.has_pipa, false)                       AS has_pipa,
    m.permissions,
    x.phoenix_ids,
    y.collection_ids
  FROM grp g
  LEFT JOIN lang l ON l.id = g.id
  LEFT JOIN cov  c ON c.id = g.id
  LEFT JOIN cls  k ON k.id = g.id
  LEFT JOIN prm  m ON m.id = g.id
  LEFT JOIN phx  x ON x.id = g.id
  LEFT JOIN coll y ON y.id = g.id
)

SELECT
  SUM(p.child_count)                                                        AS image_count,
  COUNT(*)                                                                  AS group_count,
  CASE WHEN s.detail <> 'total' THEN p.langs END                            AS langs,
  CASE WHEN s.detail IN ('record_type', 'group') THEN p.record_types END    AS record_types,
  -- the columns below are filled only when detail = 'group'
  CASE WHEN s.detail = 'group' THEN p.group_name END                        AS group_name,
  CASE WHEN s.detail = 'group' THEN p.id END                                AS group_id,
  CASE WHEN s.detail = 'group' THEN p.classifications END                   AS classifications,
  CASE WHEN s.detail = 'group' THEN
    CASE WHEN p.has_top AND p.has_mid THEN 'Top + mid-tier'
         WHEN p.has_top THEN 'Top-tier only'
         WHEN p.has_mid THEN 'Mid-tier only'
         ELSE 'Neither' END
  END                                                                       AS tier,
  CASE WHEN s.detail = 'group' THEN
    CASE WHEN p.full_text_done THEN 'Processed' ELSE 'Not processed' END
  END                                                                       AS full_text,
  CASE WHEN s.detail = 'group' THEN p.permissions END                       AS permissions,
  CASE WHEN s.detail = 'group' THEN p.group_type END                        AS group_type,
  CASE WHEN s.detail = 'group' THEN p.phoenix_ids END                       AS phoenix_ids,
  CASE WHEN s.detail = 'group' THEN p.collection_ids END                    AS collection_ids,
  s.variation
FROM profile p
CROSS JOIN s
WHERE
  -- permissions: Temple is always left out
  NOT p.has_temple
  AND CASE s.pipa
        WHEN 'include' THEN true
        WHEN 'exclude' THEN NOT p.has_pipa
        WHEN 'only'    THEN p.has_pipa
        ELSE false END

  -- indexed or not
  AND (s.index_status = 'any' OR p.index_status = s.index_status)

  -- tier
  AND CASE s.tier
        WHEN 'top_any'    THEN p.has_top
        WHEN 'top_only'   THEN p.has_top AND NOT p.has_mid
        WHEN 'mid_only'   THEN p.has_mid AND NOT p.has_top
        WHEN 'mid_any'    THEN p.has_mid
        WHEN 'top_or_mid' THEN p.has_top OR p.has_mid
        WHEN 'any'        THEN true
        ELSE false END

  -- languages: the group has at least one listed language and none outside the list
  AND (
    array_contains(s.languages, '*')
    OR (
      p.lang_count >= 1
      AND size(array_except(p.lang_arr, s.languages)) = 0
      AND CASE s.language_mix
            WHEN 'mixed_ok'      THEN true
            WHEN 'one_per_group' THEN p.lang_count = 1
            ELSE false END
    )
  )

  -- classification
  AND CASE s.classification
        WHEN 'any'              THEN true
        WHEN 'natural_language' THEN p.has_natural_language
        WHEN 'form'             THEN p.has_form
        ELSE false END

  -- full-text processing
  AND CASE s.full_text
        WHEN 'any'           THEN true
        WHEN 'not_processed' THEN NOT p.full_text_done
        WHEN 'processed'     THEN p.full_text_done
        ELSE false END

  -- places
  AND NOT p.place_excluded
  AND (s.only_place_like IS NULL OR p.place_included)

  -- specific record types and specific groups
  AND (array_contains(s.record_types, '*') OR arrays_overlap(p.record_type_ids, s.record_types))
  AND (array_contains(s.only_groups, '*') OR array_contains(s.only_groups, CAST(p.group_name AS STRING)))

GROUP BY 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
ORDER BY image_count DESC
