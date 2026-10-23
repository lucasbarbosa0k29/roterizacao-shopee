import test from "node:test";
import assert from "node:assert/strict";

const placesModule: typeof import("./google-places-new") = await import(
  new URL("./google-places-new.ts", import.meta.url).href
);
const searchModule: typeof import("./google-manual-search") = await import(
  new URL("./google-manual-search.ts", import.meta.url).href
);
const {
  buildGooglePlacesNewSearchPayload,
  fetchWithGooglePlacesTimeout,
  GOOGLE_PLACES_NEW_FIELD_MASK,
  GooglePlacesNewError,
  mapGooglePlacesNewResponse,
  shouldFallbackToLegacy,
} = placesModule;
const { compareGoogleManualSearchResults, sortGoogleManualSearchResults } = searchModule;

const request = {
  query: "Rua das Flores, 100, Goiânia",
  city: "Goiânia",
  district: "Setor Central",
  center: { lat: -16.6869, lng: -49.2643 },
  radius: 12_000,
  language: "pt-BR",
  region: "br",
};

test("Places New usa somente o field mask de dados necessários", () => {
  assert.equal(
    GOOGLE_PLACES_NEW_FIELD_MASK,
    "places.id,places.displayName,places.formattedAddress,places.location",
  );
  assert.deepEqual(buildGooglePlacesNewSearchPayload(request), {
    textQuery: request.query,
    languageCode: "pt-BR",
    regionCode: "BR",
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: { latitude: request.center.lat, longitude: request.center.lng },
        radius: request.radius,
      },
    },
  });
});

test("resposta New preserva nome, endereço e coordenadas válidas", () => {
  const results = mapGooglePlacesNewResponse({
    places: [
      {
        id: "place-1",
        displayName: { text: "Local 1" },
        formattedAddress: "Rua 1, Goiânia - GO",
        location: { latitude: -16.68, longitude: -49.25 },
      },
      {
        id: "place-2",
        displayName: { text: "Local 2" },
        formattedAddress: "Rua 2, Goiânia - GO",
        location: { latitude: "invalid", longitude: -49.25 },
      },
    ],
  });

  assert.deepEqual(results, [
    {
      id: "place-1",
      name: "Local 1",
      address: "Rua 1, Goiânia - GO",
      pos: { lat: -16.68, lng: -49.25 },
    },
  ]);
});

test("coordenadas fora dos limites geográficos são descartadas", () => {
  assert.deepEqual(
    mapGooglePlacesNewResponse({
      places: [
        {
          id: "invalid",
          displayName: { text: "Inválido" },
          formattedAddress: "",
          location: { latitude: 91, longitude: 0 },
        },
      ],
    }),
    [],
  );
});

test("compara ordem e divergência de coordenadas", () => {
  const legacy = [
    { id: "a", name: "Local A", address: "Setor Central, Goiânia", pos: { lat: -16.6869, lng: -49.2643 } },
    { id: "b", name: "Local B", address: "Setor Oeste, Goiânia", pos: { lat: -16.7, lng: -49.27 } },
  ];
  const newer = [
    { ...legacy[1] },
    { ...legacy[0], pos: { lat: -16.6871, lng: -49.2643 } },
  ];
  const comparison = compareGoogleManualSearchResults(legacy, newer);

  assert.equal(comparison.commonIds, 2);
  assert.equal(comparison.sameOrder, false);
  assert.equal(comparison.coordinateMismatchesOver10m, 1);
  assert.ok((comparison.maxCommonCoordinateDistanceM ?? 0) > 10);
});

test("ordenação manual continua priorizando cidade e bairro", () => {
  const results = [
    { id: "outside", name: "Local", address: "Setor Central, Brasília - DF", pos: { lat: -15.8, lng: -47.9 } },
    { id: "inside", name: "Local", address: "Setor Central, Goiânia - GO", pos: { lat: -16.6869, lng: -49.2643 } },
  ];

  assert.deepEqual(
    sortGoogleManualSearchResults(results, {
      searchText: "Local",
      city: "Goiânia",
      district: "Setor Central",
      center: { lat: -16.6869, lng: -49.2643 },
    }).map((result) => result.id),
    ["inside", "outside"],
  );
});

test("timeout aborta fetch pendente e falhas não recuperáveis não fazem fallback", async () => {
  await assert.rejects(
    fetchWithGooglePlacesTimeout(
      "https://example.test",
      {},
      1,
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ),
    (error: unknown) =>
      error instanceof GooglePlacesNewError && error.code === "GOOGLE_PLACES_NEW_TIMEOUT",
  );
  assert.equal(
    shouldFallbackToLegacy(new GooglePlacesNewError("GOOGLE_PLACES_NEW_QUOTA", "quota")),
    false,
  );
  assert.equal(
    shouldFallbackToLegacy(new GooglePlacesNewError("GOOGLE_PLACES_NEW_UPSTREAM", "temporary")),
    true,
  );
});
