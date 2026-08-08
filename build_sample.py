#!/usr/bin/env python3
"""스타터킷 샘플 데이터 생성 — 정세균 구술 기반.
data/ 아래에 places.csv, events.csv, graph.ttl, ontology.json 을 만든다.
전거는 02-site 에서 파싱한 역대 국회의장단 마스터를 재사용한다.
"""
import csv
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"
DATA.mkdir(exist_ok=True)
SITE = HERE.parent / "02-site"

roster = json.loads((SITE / "_speakers_raw.json").read_text(encoding="utf-8"))

# ── 장소 (지도) ────────────────────────────────────────────────────────────
PLACES = [
    ("place/jinan", "전라북도 진안", 35.7917, 127.4250, "출생", "1950년 출생지"),
    ("place/jeonju", "전주", 35.8242, 127.1480, "학창", "전주 신흥고등학교"),
    ("place/korea-univ", "고려대학교", 37.5894, 127.0324, "학창", "법학과·총학생회장(1973)"),
    ("place/ssangyong", "쌍용그룹 본사", 37.5665, 126.9780, "직장", "1978년 공채 입사"),
    ("place/newyork", "뉴욕", 40.7128, -74.0060, "해외", "쌍용 뉴욕지점 4년"),
    ("place/losangeles", "로스앤젤레스", 34.0522, -118.2437, "해외", "쌍용 LA지점 5년"),
    ("place/pepperdine", "페퍼다인대학교", 34.0416, -118.7101, "학업", "1990년 경영학 석사"),
    ("place/assembly", "국회의사당", 37.5320, 126.9140, "의정", "서울 여의도. 제15~20대 의정 활동과 제20대 전반기 국회의장 재임의 무대"),
    ("place/muju", "무주", 36.0070, 127.6610, "지역구", "무진장(무주·진안·장수)"),
    ("place/jangsu", "장수", 35.6473, 127.5210, "지역구", "무진장(무주·진안·장수)"),
    ("place/shinheung", "전주 신흥고등학교", 35.8114, 127.1480, "학창", "1969년 졸업"),
    ("place/nanet", "국회도서관", 37.5312, 126.9137, "기관", "구술총서 발행처"),
    ("place/nafr", "국회미래연구원", 37.5285, 126.9195, "기관", "2018년 설립"),
]

# ── 사건 (연표) ────────────────────────────────────────────────────────────
EVENTS = [
    ("event/yushin", "10월유신 선포", "1972-10-17", "정치", "박정희 대통령 유신 선포. 재학 중 반대 시위 참여"),
    ("event/donga", "동아일보 광고탄압", "1974-12", "언론", "자유언론실천선언 이후 광고 탄압"),
    ("event/president-election-1997", "제15대 대통령선거", "1997-12-18", "정치", "김대중 당선, 최초의 평화적 정권교체"),
    ("event/hanbo", "한보사태", "1997-01", "경제", "재벌 문어발식 확장의 상징. 외환위기의 한 원인"),
    ("event/imf", "IMF 외환위기", "1997-11-21", "경제", "국제통화기금 구제금융 신청"),
    ("event/nosajeong", "노사정위원회 1기 대타협", "1998-02-06", "노동", "경제위기 극복을 위한 사회협약"),
    ("event/impeach-roh", "노무현 대통령 탄핵소추", "2004-03-12", "정치", "국회 가결, 헌재 기각"),
    ("event/uri-party", "열린우리당 창당", "2003-11-11", "정당", "새천년민주당 분당"),
    ("event/impeach-park", "박근혜 대통령 탄핵소추", "2016-12-09", "정치", "국회 가결, 헌재 인용"),
    ("event/speaker-inaug", "제20대 전반기 국회의장 취임", "2016-06-09", "의정", "'국민에게 힘이 되는 국회' 일성"),
    ("event/nafr", "국회미래연구원 설립", "2018-05-28", "의정", "여야 설득 끝에 설립"),
    ("event/cleaner", "국회 청소노동자 정규직 전환", "2017-01-01", "노동", "고용의 질 개선"),
    ("event/privilege", "국회의원 특권 내려놓기", "2016-07", "의정", "특권 내려놓기 추진위원회"),
    ("event/speaker-retire", "국회의장 퇴임", "2018-05-29", "의정", "제20대 전반기 임기 종료"),
    ("event/student-pres", "고려대 총학생회장 당선", "1973", "학창", "재학 중 학생운동 참여"),
    ("event/graduate", "고려대학교 법학과 졸업", "1975", "학창", "졸업 후 육군 입대"),
    ("event/ssangyong-join", "쌍용그룹 공채 입사", "1978", "직장", "이후 뉴욕·LA 지점 근무"),
    ("event/pepperdine", "페퍼다인대학교 경영학 석사", "1990", "학업", "미국 유학"),
    ("event/enter-politics", "정계 입문", "1995", "정치", "권노갑 권유로 민주당 입당"),
    ("event/elected-15", "제15대 국회의원 당선", "1996-04-11", "정치", "전북 진안·무주·장수"),
    ("event/oct26", "10·26 사태", "1979-10-26", "정치", "박정희 대통령 서거"),
    ("event/may18", "5·18민주화운동", "1980-05-18", "정치", "광주"),
    ("event/interview", "국회의장단 구술채록", "2018-08", "기록", "국회기록보존소, 면담자 손동유"),
]

# ── 행위자 ────────────────────────────────────────────────────────────────
PERSONS = [
    ("agent/jsk", "정세균", "1950", "구술자. 제15~20대 국회의원, 제20대 전반기 국회의장, 국무총리"),
    ("agent/kdj", "김대중", "1924", "제15대 대통령. 새정치국민회의 총재"),
    ("agent/rmh", "노무현", "1946", "제16대 대통령"),
    ("agent/gnk", "권노갑", "1930", "새정치국민회의 고문. 정계 입문 권유"),
    ("agent/kkt", "김근태", "1947", "열린우리당 의장"),
    ("agent/kwk", "김원기", "1937", "노사정위원회 2기 위원장, 제17대 전반기 국회의장"),
    ("agent/sdy", "손동유", None, "면담자. 명지대학교 연구교수, 한국사·기록학"),
    ("agent/pgh", "박근혜", "1952", "제18대 대통령"),
]
ORGS = [
    ("org/assembly", "대한민국 국회", "입법부"),
    ("org/nca", "새정치국민회의", "1995년 창당"),
    ("org/mdp", "새천년민주당", "2000년 창당"),
    ("org/uri", "열린우리당", "2003년 창당"),
    ("org/ssangyong", "쌍용그룹", "1978년 입사, 1995년 상무이사 퇴사"),
    ("org/nosajeong", "노사정위원회", "현 경제사회노동위원회"),
    ("org/nafr", "국회미래연구원", "2018년 설립"),
    ("org/nanet", "국회도서관", "구술총서 발행처"),
]
POSITIONS = [
    ("pos/speaker-20-1", "제20대 전반기 국회의장", "2016-06-09", "2018-05-29"),
    ("pos/member-15", "제15대 국회의원", "1996-05-30", "2000-05-29"),
    ("pos/speaker-17-1", "제17대 전반기 국회의장", "2004-06-05", "2006-05-29"),
    ("pos/floor-leader", "원내대표", "2007-02", "2008-05"),
    ("pos/party-leader", "당대표", "2008-07", "2010-08"),
]
RULES = [
    ("rule/constitution", "대한민국헌법", "국가 최고규범"),
    ("rule/assembly-act", "국회법", "국회 운영에 관한 법률"),
    ("rule/pastaffairs", "과거사법", "진실·화해를 위한 과거사정리 기본법"),
    ("rule/basic-livelihood", "국민기초생활보장법", "1999년 제정"),
    ("rule/nafr-act", "국회미래연구원법", "2018년 제정"),
]
ACTIVITIES = [
    ("act/oral-project", "국회의장단 구술기록 아카이브 구축 사업", "2012", "국회기록보존소"),
    ("act/privilege-reform", "국회의원 특권 내려놓기 추진", "2016", "제20대 전반기"),
    ("act/labor-reform", "노동 고용의 질 개선 활동", "1998", "노사정위원회부터"),
]
RECORDS = [
    ("rec/jsk-1", "정세균 1차 구술", "2018-08", "성장 과정과 사회 진출", 21),
    ("rec/jsk-2", "정세균 2차 구술", "2018-09", "제15·16대 국회 활동", 61),
    ("rec/jsk-3", "정세균 3차 구술", "2018-10", "제17~19대 국회 활동", 121),
    ("rec/jsk-4", "정세균 4차 구술", "2018-11", "제20대 국회와 국회의장직", 163),
]


def esc(s):
    return str(s).replace('"', '\\"')


def nid(s):
    """Turtle 지역명에는 '/'를 쓸 수 없다(PN_LOCAL 규칙). 하이픈으로 바꾼다."""
    return str(s).replace("/", "-")


ttl = ["""@prefix rico: <https://www.ica.org/standards/RiC/ontology#> .
@prefix ric:  <http://archives.nanet.go.kr/id/> .
@prefix geo:  <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

# 국회의장단 구술기록 샘플 그래프 — 정세균
# 어휘: RiC-O 1.1 구술 프로파일 (Core)
# 출처: 국회도서관 국회기록보존소, 『대한민국 국회를 말하다 08 정세균』, 2021.
"""]

ttl.append("\n# ── 기록집합·기록 ──")
ttl.append("""ric:recset/speakers a rico:RecordSet ;
    rico:title "국회의장단 구술총서" ;
    rico:hasPublisher ric:org/nanet .

ric:recset/jsk a rico:RecordSet ;
    rico:title "대한민국 국회를 말하다 08 정세균" ;
    rico:isOrWasIncludedIn ric:recset/speakers ;
    rico:hasCreator ric:agent/jsk ;
    rico:hasPublisher ric:org/nanet ;
    rico:beginningDate "2021-02-25" .""")
for rid, title, date, scope, page in RECORDS:
    ttl.append(f"""
ric:{nid(rid)} a rico:Record ;
    rico:title "{esc(title)}" ;
    rico:scopeAndContent "{esc(scope)}" ;
    rico:isOrWasIncludedIn ric:recset/jsk ;
    rico:hasCreator ric:agent/jsk ;
    rico:hasAuthor ric:agent/sdy ;
    rico:beginningDate "{date}" ;
    rico:identifier "{page}" .""")

ttl.append("\n# ── 인물 ──")
for aid, name, birth, desc in PERSONS:
    b = f'\n    rico:birthDate "{birth}" ;' if birth else ""
    ttl.append(f"""
ric:{nid(aid)} a rico:Person ;
    rico:name "{esc(name)}" ;{b}
    rico:history "{esc(desc)}" .""")

ttl.append("\n# ── 단체 ──")
for oid, name, desc in ORGS:
    ttl.append(f"""
ric:{nid(oid)} a rico:CorporateBody ;
    rico:name "{esc(name)}" ;
    rico:history "{esc(desc)}" .""")

ttl.append("\n# ── 직위 (전거의 핵심) ──")
for pid, name, s, e in POSITIONS:
    ttl.append(f"""
ric:{nid(pid)} a rico:Position ;
    rico:name "{esc(name)}" ;
    rico:existsOrExistedIn ric:org/assembly ;
    rico:beginningDate "{s}" ;
    rico:endDate "{e}" .""")

ttl.append("\n# ── 장소 ──")
for pid, name, lat, lon, kind, desc in PLACES:
    ttl.append(f"""
ric:{nid(pid)} a rico:Place ;
    rico:name "{esc(name)}" ;
    rico:generalDescription "{esc(desc)}" ;
    geo:lat "{lat}" ; geo:long "{lon}" ;
    rdfs:comment "{kind}" .""")

ttl.append("\n# ── 사건 ──")
for eid, name, date, kind, desc in EVENTS:
    ttl.append(f"""
ric:{nid(eid)} a rico:Event ;
    rico:name "{esc(name)}" ;
    rico:generalDescription "{esc(desc)}" ;
    rico:beginningDate "{date}" ;
    rdfs:comment "{kind}" .""")

ttl.append("\n# ── 규칙(법령) ──")
for rid, name, desc in RULES:
    ttl.append(f"""
ric:{nid(rid)} a rico:Rule ;
    rico:name "{esc(name)}" ;
    rico:generalDescription "{esc(desc)}" .""")

ttl.append("\n# ── 활동 ──")
for aid, name, start, desc in ACTIVITIES:
    ttl.append(f"""
ric:{nid(aid)} a rico:Activity ;
    rico:name "{esc(name)}" ;
    rico:beginningDate "{start}" ;
    rico:generalDescription "{esc(desc)}" .""")

ttl.append("\n# ── 관계 ──")
REL = [
    ("agent/jsk", "occupiesOrOccupied", "pos/speaker-20-1"),
    ("agent/jsk", "occupiesOrOccupied", "pos/member-15"),
    ("agent/jsk", "occupiesOrOccupied", "pos/floor-leader"),
    ("agent/jsk", "occupiesOrOccupied", "pos/party-leader"),
    ("agent/kwk", "occupiesOrOccupied", "pos/speaker-17-1"),
    ("agent/jsk", "isOrWasMemberOf", "org/nca"),
    ("agent/jsk", "isOrWasMemberOf", "org/mdp"),
    ("agent/jsk", "isOrWasMemberOf", "org/uri"),
    ("agent/jsk", "isOrWasMemberOf", "org/ssangyong"),
    ("agent/kdj", "isOrWasMemberOf", "org/nca"),
    ("agent/gnk", "isOrWasMemberOf", "org/nca"),
    ("agent/kkt", "isOrWasMemberOf", "org/uri"),
    ("agent/jsk", "isOrWasParticipantIn", "event/yushin"),
    ("agent/jsk", "isOrWasParticipantIn", "event/hanbo"),
    ("agent/jsk", "isOrWasParticipantIn", "event/nosajeong"),
    ("agent/jsk", "isOrWasParticipantIn", "event/impeach-roh"),
    ("agent/jsk", "isOrWasParticipantIn", "event/impeach-park"),
    ("agent/jsk", "isOrWasParticipantIn", "event/speaker-inaug"),
    ("agent/jsk", "isOrWasParticipantIn", "event/nafr"),
    ("agent/jsk", "isOrWasParticipantIn", "event/cleaner"),
    ("agent/jsk", "isOrWasParticipantIn", "event/privilege"),
    ("agent/kdj", "isOrWasParticipantIn", "event/president-election-1997"),
    ("agent/rmh", "isOrWasParticipantIn", "event/impeach-roh"),
    ("agent/pgh", "isOrWasParticipantIn", "event/impeach-park"),
    ("agent/kwk", "isOrWasParticipantIn", "event/nosajeong"),
    ("agent/jsk", "isAssociatedWithPlace", "place/jinan"),
    ("agent/jsk", "isAssociatedWithPlace", "place/korea-univ"),
    ("agent/jsk", "isAssociatedWithPlace", "place/newyork"),
    ("agent/jsk", "isAssociatedWithPlace", "place/assembly"),
    ("agent/gnk", "isRelatedTo", "agent/jsk"),
    ("org/assembly", "hasOrHadPosition", "pos/speaker-20-1"),
    ("org/assembly", "hasOrHadPosition", "pos/member-15"),
    ("org/assembly", "hasOrHadPosition", "pos/speaker-17-1"),
    ("event/nafr", "resultsOrResultedIn", "org/nafr"),
    ("agent/jsk", "isOrWasParticipantIn", "event/student-pres"),
    ("agent/jsk", "isOrWasParticipantIn", "event/graduate"),
    ("agent/jsk", "isOrWasParticipantIn", "event/ssangyong-join"),
    ("agent/jsk", "isOrWasParticipantIn", "event/pepperdine"),
    ("agent/jsk", "isOrWasParticipantIn", "event/enter-politics"),
    ("agent/jsk", "isOrWasParticipantIn", "event/elected-15"),
    ("agent/jsk", "isOrWasParticipantIn", "event/interview"),
    ("agent/sdy", "isOrWasParticipantIn", "event/interview"),
    ("agent/gnk", "isOrWasParticipantIn", "event/enter-politics"),
    ("agent/jsk", "isAssociatedWithPlace", "place/jeonju"),
    ("agent/jsk", "isAssociatedWithPlace", "place/shinheung"),
    ("agent/jsk", "isAssociatedWithPlace", "place/losangeles"),
    ("agent/jsk", "isAssociatedWithPlace", "place/pepperdine"),
    ("agent/jsk", "isAssociatedWithPlace", "place/muju"),
    ("agent/jsk", "isAssociatedWithPlace", "place/jangsu"),
    ("event/student-pres", "isAssociatedWithPlace", "place/korea-univ"),
    ("event/graduate", "isAssociatedWithPlace", "place/korea-univ"),
    ("event/ssangyong-join", "isAssociatedWithPlace", "place/ssangyong"),
    ("event/pepperdine", "isAssociatedWithPlace", "place/pepperdine"),
    ("event/may18", "isAssociatedWithPlace", "place/assembly"),
    ("event/speaker-inaug", "isAssociatedWithPlace", "place/assembly"),
    ("event/nafr", "isAssociatedWithPlace", "place/nafr"),
    ("event/cleaner", "isAssociatedWithPlace", "place/assembly"),
    ("org/nanet", "isAssociatedWithPlace", "place/nanet"),
    ("org/assembly", "isAssociatedWithPlace", "place/assembly"),
    ("org/nafr", "isAssociatedWithPlace", "place/nafr"),
    ("act/oral-project", "hasOrHadParticipant", "agent/sdy"),
    ("act/oral-project", "hasOrHadParticipant", "agent/jsk"),
    ("act/privilege-reform", "hasOrHadParticipant", "agent/jsk"),
    ("act/labor-reform", "hasOrHadParticipant", "agent/jsk"),
    ("act/oral-project", "resultsOrResultedIn", "recset/jsk"),
    ("event/nafr", "isOrWasRegulatedBy", "rule/nafr-act"),
    ("event/privilege", "isOrWasRegulatedBy", "rule/assembly-act"),
    ("event/impeach-park", "isOrWasRegulatedBy", "rule/constitution"),
    ("event/impeach-roh", "isOrWasRegulatedBy", "rule/constitution"),
    ("agent/jsk", "isOrWasParticipantIn", "act/oral-project"),
    ("agent/kdj", "isOrWasParticipantIn", "event/oct26"),
    ("org/nca", "hasOrHadMember", "agent/kdj"),
    ("org/nca", "hasOrHadMember", "agent/gnk"),
    ("org/uri", "hasOrHadMember", "agent/kkt"),
    ("org/assembly", "hasOrHadPosition", "pos/floor-leader"),
    ("org/assembly", "hasOrHadPosition", "pos/party-leader"),
]
SUBJ = [
    ("rec/jsk-1", ["event/yushin", "event/donga", "place/jinan", "place/korea-univ",
                   "agent/gnk", "agent/kdj", "org/nca", "org/ssangyong",
                   "event/student-pres", "event/graduate", "event/ssangyong-join",
                   "event/pepperdine", "event/enter-politics", "event/elected-15",
                   "place/jeonju", "place/shinheung", "place/newyork"]),
    ("rec/jsk-2", ["event/hanbo", "event/imf", "event/nosajeong",
                   "agent/kdj", "agent/kwk", "org/nosajeong"]),
    ("rec/jsk-3", ["event/impeach-roh", "event/uri-party", "agent/rmh",
                   "agent/kkt", "org/uri", "org/mdp"]),
    ("rec/jsk-4", ["event/impeach-park", "event/speaker-inaug", "event/nafr",
                   "event/cleaner", "event/privilege", "agent/pgh",
                   "pos/speaker-20-1", "org/nafr", "rule/assembly-act",
                   "rule/nafr-act", "act/privilege-reform", "place/assembly"]),
]
for s, p, o in REL:
    ttl.append(f"ric:{nid(s)}  rico:{p}  ric:{nid(o)} .")
for rid, subs in SUBJ:
    for o in subs:
        ttl.append(f"ric:{nid(rid)}  rico:hasOrHadSubject  ric:{nid(o)} .")

out = "\n".join(ttl) + "\n"
# Turtle PN_LOCAL 규칙: 지역명에 '/' 불가 → 하이픈으로 일괄 정규화
out = re.sub(r"\bric:([A-Za-z0-9/_.-]+)",
             lambda m: "ric:" + m.group(1).replace("/", "-"), out)
(DATA / "graph.ttl").write_text(out, encoding="utf-8")

# ── CSV (지도·연표용, 편집 쉬우라고 별도 제공) ─────────────────────────────
with open(DATA / "places.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["id", "name", "lat", "lng", "type", "desc"])
    for r in PLACES:
        w.writerow(r)
with open(DATA / "events.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["id", "name", "date", "type", "desc"])
    for r in EVENTS:
        w.writerow(r)

# ── 전거 마스터 (역대 국회의장단 전체) ─────────────────────────────────────
(DATA / "authority.json").write_text(
    json.dumps(roster, ensure_ascii=False, indent=1), encoding="utf-8")

n_triples = sum(1 for line in "\n".join(ttl).split("\n")
                if line.strip().endswith(".") or line.strip().endswith(";"))
print("샘플 데이터 생성 완료")
print(f"  data/graph.ttl      인물 {len(PERSONS)} · 단체 {len(ORGS)} · 직위 {len(POSITIONS)} · "
      f"장소 {len(PLACES)} · 사건 {len(EVENTS)} · 기록 {len(RECORDS)}")
print(f"  data/places.csv     {len(PLACES)}행")
print(f"  data/events.csv     {len(EVENTS)}행")
print(f"  data/authority.json 역대 국회의장단 {len(roster)}건")
