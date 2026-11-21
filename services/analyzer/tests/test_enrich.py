"""Normalizacja odpowiedzi KRS i GLEIF na danych syntetycznych (bez sieci)."""
import time

import pytest

from app import enrich

KRS_FIXTURE = ("P", {"odpis": {
    "naglowekA": {"numerKRS": "0000999999", "dataRejestracjiWKRS": "01.02.2015", "stanZDnia": "20.11.2026", "dataOstatniegoWpisu": "10.10.2026"},
    "dane": {
        "dzial1": {
            "danePodmiotu": {"nazwa": "SYNTETYCZNA SPÓŁKA TESTOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", "formaPrawna": "SPÓŁKA Z O.O.",
                             "identyfikatory": {"nip": "1234567890", "regon": "123456789"}},
            "siedzibaIAdres": {"siedziba": {"miejscowosc": "WARSZAWA"},
                               "adres": {"ulica": "UL. PRZYKŁADOWA", "nrDomu": "1", "kodPocztowy": "00-001", "miejscowosc": "WARSZAWA", "kraj": "POLSKA"},
                               "adresStronyInternetowej": "WWW.SPOLKA.EXAMPLE"},
            "kapital": {"wysokoscKapitaluZakladowego": {"wartosc": "5 000,00", "waluta": "PLN"}},
            "wspolnicySpzoo": [{"nazwisko": {"nazwiskoICzlon": "K***"}, "imiona": {"imie": "J***"}, "posiadaneUdzialy": "100 UDZIAŁÓW"}],
        },
        "dzial2": {
            "reprezentacja": {"nazwaOrganu": "ZARZĄD", "sposobReprezentacji": "PREZES SAMODZIELNIE",
                              "sklad": [{"nazwisko": {"nazwiskoICzlon": "N***"}, "imiona": {"imie": "A***"}, "funkcjaWOrganie": "PREZES ZARZĄDU", "czyZawieszona": False}]},
            "prokurenci": [{"nazwisko": {"nazwiskoICzlon": "P***"}, "imiona": {"imie": "E***"}, "rodzajProkury": "PROKURA SAMOISTNA"}],
        },
    }}})


@pytest.fixture(autouse=True)
def clean_cache():
    enrich._cache.clear()
    yield
    enrich._cache.clear()


def test_krs_normalization():
    enrich._cache["krs:0000999999"] = (time.time(), KRS_FIXTURE)
    d = enrich.krs("0000999999")
    assert d["nip"] == "1234567890" and d["regon"] == "123456789"
    assert d["capital"] == {"value": 5000.0, "currency": "PLN"}
    assert d["address"] == "UL. PRZYKŁADOWA 1, 00-001 WARSZAWA, POLSKA"
    assert d["registered_at"] == "01.02.2015"
    roles = [(p["role"], p["function"]) for p in d["persons"]]
    assert ("ZARZĄD", "PREZES ZARZĄDU") in roles and ("prokurent", "PROKURA SAMOISTNA") in roles
    assert d["shareholders"][0]["shares"] == "100 UDZIAŁÓW"
    assert d["persons_masked"] is True


def test_krs_rejects_bad_number():
    with pytest.raises(ValueError):
        enrich.krs("12345")


def test_gleif_record_normalization():
    rec = {"id": "5299000000000000AB12", "attributes": {"lei": "5299000000000000AB12",
           "entity": {"legalName": {"name": "SYNTHETIC TEST AG"}, "legalAddress": {"addressLines": ["Teststr. 1"], "postalCode": "10115", "city": "Berlin", "country": "DE"},
                      "legalForm": {"id": "8Z6G"}, "status": "ACTIVE", "registeredAs": "HRB 1"},
           "registration": {"status": "ISSUED", "nextRenewalDate": "2027-01-01"}}}
    g = enrich._gleif_record(rec)
    assert (g["lei"], g["name"], g["country"], g["entity_status"]) == ("5299000000000000AB12", "SYNTHETIC TEST AG", "DE", "ACTIVE")
    assert g["address"] == "Teststr. 1, 10115, Berlin, DE"


def test_gleif_requires_name_or_lei():
    with pytest.raises(ValueError):
        enrich.gleif()
    with pytest.raises(ValueError):
        enrich.gleif(lei="zly")
