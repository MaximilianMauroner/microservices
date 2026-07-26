import express from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { shooAuth } from "../src/auth.js";
import { reviewConsole } from "../src/ui.js";

describe("Shoo review UI", () => {
  it("serves PKCE, separate scopes, history, evidence, and valid action controls", async () => {
    const app=express().get(["/review","/review/callback"],reviewConsole);const response=await request(app).get("/review");
    expect(response.text).toContain("Shoo.startSignIn");expect(response.text).toContain("data-scope=project");expect(response.text).toContain("data-scope=global");expect(response.text).toContain("data-view=history");expect(response.text).toContain("Evidence");expect(response.text).toContain("confirm_valid");expect(response.text).not.toContain("data-action=edit");
  });
  it("verifies ES256 issuer, audience, verified email, and exact account", async () => {
    const {privateKey,publicKey}=await generateKeyPair("ES256");const jwk=await exportJWK(publicKey);jwk.kid="test";const key=async()=>publicKey;const app=express().get("/",shooAuth({allowedEmail:"owner@example.com",audience:"origin:https://reviews.example",issuer:"https://shoo.dev",jwks:key}),(_q,res)=>res.json({ok:true}));
    const token=await new SignJWT({email:"owner@example.com",email_verified:true}).setProtectedHeader({alg:"ES256",kid:jwk.kid}).setIssuer("https://shoo.dev").setAudience("origin:https://reviews.example").setExpirationTime("5m").sign(privateKey);
    expect((await request(app).get("/").set("Authorization",`Bearer ${token}`)).status).toBe(200);
    const wrong=await new SignJWT({email:"other@example.com",email_verified:true}).setProtectedHeader({alg:"ES256"}).setIssuer("https://shoo.dev").setAudience("origin:https://reviews.example").setExpirationTime("5m").sign(privateKey);
    expect((await request(app).get("/").set("Authorization",`Bearer ${wrong}`)).status).toBe(403);
    const wrongAudience=await new SignJWT({email:"owner@example.com",email_verified:true}).setProtectedHeader({alg:"ES256"}).setIssuer("https://shoo.dev").setAudience("origin:https://wrong.example").setExpirationTime("5m").sign(privateKey);
    expect((await request(app).get("/").set("Authorization",`Bearer ${wrongAudience}`)).status).toBe(401);
    expect((await request(app).get("/")).status).toBe(401);
  });
});
