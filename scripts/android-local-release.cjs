#!/usr/bin/env node
'use strict';
// Registered-home build only. No clone, worktree, source export, cloud build or install.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
function run(exe,args,opts={}) {
 const result=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,...opts});
 if(result.error||result.status!==0) throw Error(`Stopped: ${path.basename(exe)} ${args[0]||''} (${result.status})${opts.stdio==='inherit'?'':`\n${result.stderr||result.error?.message||''}`}`);
 return (result.stdout||'').trim();
}
function profileFor(profiles,name,seen=[]) {
 if(seen.includes(name)||!profiles[name])throw Error('Invalid/circular build profile');
 const own=profiles[name],parent=own.extends?profileFor(profiles,own.extends,[...seen,name]):{};
 return {...parent,...own,env:{...parent.env,...own.env},android:{...parent.android,...own.android}};
}
function validateReservation(rows,head,branch,version) {
 const refs=new Map(rows.trim().split(/\r?\n/).filter(Boolean).map(row=>{const [hash,ref]=row.split(/\s+/);return [ref,hash];}));
 if(refs.get(`refs/tags/android-release-v${version}^{}`)!==head)throw Error('Missing/mismatched annotated GitHub reservation');
 for(const name of [branch])if(refs.get(`refs/heads/${name}`)!==head)throw Error('Remote release branches moved or are not reconciled');
 for(const ref of refs.keys()) {const m=/^refs\/tags\/android-release-v(\d+)(?:\^\{\})?$/.exec(ref);if(m&&Number(m[1])>version)throw Error('A higher remote version is already reserved');}
}
function main(args=process.argv.slice(2)) {
 const opt={};for(let i=0;i<args.length;i+=2){if(!['--baseline-apk','--highest-evidence-version','--credentials','--profile'].includes(args[i])||!args[i+1])throw Error('Invalid release arguments');opt[args[i].slice(2)]=args[i+1];}
 const root=fs.realpathSync(path.resolve(__dirname,'..'));
 const git=(...args)=>run('git',args,{cwd:root});
 const control='C:/dev/workspace-control';
 const guard=()=>run(process.execPath,[path.join(control,'git-hook.cjs')],{cwd:root});
 guard();
 if(git('status','--porcelain'))throw Error('Commit/preserve all source changes before building');
 const head=git('rev-parse','HEAD'),branch=git('branch','--show-current');
 if(git('remote','get-url','origin')!=='https://github.com/tester3x/wellbuilt-suite.git')throw Error('Unexpected remote');
 const config=JSON.parse(fs.readFileSync(path.join(root,'app.json'))).expo;
 const version=config.android.versionCode,highest=Number(opt['highest-evidence-version']);
 if(!Number.isSafeInteger(highest)||highest<104||!Number.isSafeInteger(version)||version<=highest)throw Error('Version must exceed all prior installed/APK/cloud/reservation evidence');
 const reservationRows=git('ls-remote','origin',`refs/heads/${branch}`,'refs/tags/android-release-v*');
 validateReservation(reservationRows,head,branch,version);
 const tag=`android-release-v${version}`;
 if(git('cat-file','-t',tag)!=='tag'||git('rev-parse',`${tag}^{}`)!==head)throw Error('Local immutable reservation mismatch');
 const reservation=JSON.parse(git('for-each-ref','--format=%(contents)',`refs/tags/${tag}`));
 if(reservation.package!=='com.wellbuilt.suite'||reservation.versionCode!==version||reservation.sourceCommit!==head||reservation.owner!==(process.env.CODEX_SESSION_ID||process.env.CODEX_THREAD_ID||process.env.WORKSPACE_SESSION_ID))throw Error('Reservation identity mismatch');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
 const profileName=opt.profile||'preview',profile=profileFor(JSON.parse(fs.readFileSync(path.join(root,'eas.json'))).build,profileName);
 const sdk='C:/dev/tools/android-sdk',javaHome=path.join(os.homedir(),'.gradle/jdks/eclipse_adoptium-17-amd64-windows.2'),java=path.join(javaHome,'bin/java.exe'),tools=path.join(sdk,'build-tools/36.0.0');
 const credentialsFile=path.resolve(opt.credentials||'C:/dev/local-secrets/android/com.wellbuilt.suite/credentials.json');
 const key=JSON.parse(fs.readFileSync(credentialsFile)).android.keystore;
 const keyFile=path.resolve(path.dirname(credentialsFile),key.keystorePath);
 const env={...process.env,...profile.env,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,JAVA_HOME:javaHome,CI:'1',NODE_ENV:'production',EAS_BUILD_PROFILE:profileName,WB_LOCAL_CREDENTIALS:credentialsFile,WB_LOCAL_KEYSTORE:keyFile,WB_RELEASE_VERSION_CODE:String(version)};
 env.PATH=`${path.join(javaHome,'bin')};${path.join(sdk,'platform-tools')};${env.PATH||env.Path||''}`;
 const identity=apk=>{
  const cert=run(java,['-jar',path.join(tools,'lib/apksigner.jar'),'verify','--print-certs',apk],{env});
  const signers=[...cert.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)/gi)];
  const badging=run(path.join(tools,'aapt.exe'),['dump','badging',apk],{env});
  const match=badging.match(/^package: name='([^']+)' versionCode='(\d+)'/m);
  if(signers.length!==1||!match)throw Error('Cannot verify APK identity');
  return {package:match[1],versionCode:Number(match[2]),signingSha256:signers[0][1].toLowerCase()};
 };
 const baseline=identity(path.resolve(opt['baseline-apk']||''));
 const signer=run(path.join(javaHome,'bin/keytool.exe'),['-list','-rfc','-keystore',keyFile,'-alias',key.keyAlias,'-storepass:env','WB_KEYSTORE_PASSWORD'],{env:{...env,WB_KEYSTORE_PASSWORD:key.keystorePassword}});
 const pem=signer.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
 if(!pem)throw Error('Cannot verify existing signing key');
 const signingSha256=new crypto.X509Certificate(pem[0]).fingerprint256.replace(/:/g,'').toLowerCase();
 if(baseline.package!=='com.wellbuilt.suite'||baseline.versionCode>highest||baseline.signingSha256!==signingSha256||reservation.signingSha256!==signingSha256)throw Error('Package/signing/baseline mismatch');
 // Use installed lockfile dependencies without destroying the existing ignored tree.
 const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));
 for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})){
  const installed=JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json')));
  const locked=lock.packages[`node_modules/${name}`];
  if(locked?.version&&installed.version!==locked.version)throw Error(`Installed dependency differs from lockfile: ${name}`);
 }
 const expo=path.join(root,'node_modules/expo/bin/cli');
 const resolved=JSON.parse(run(process.execPath,[expo,'config','--type','public','--json'],{cwd:root,env}));
 if(resolved.android?.package!==baseline.package||resolved.android?.versionCode!==version)throw Error('Resolved Expo identity/version mismatch');
 const worktreesBefore=git('worktree','list','--porcelain');
 const command=(exe,argv,cwd=root)=>run(exe,argv,{cwd,env,stdio:'inherit'});
 command(process.execPath,[expo,'prebuild','--platform','android','--no-install']);
 command(process.execPath,[path.join(root,'scripts/sync-suite-etc-profile.cjs')]);
 if(git('status','--porcelain','--untracked-files=no'))throw Error('Prebuild changed tracked source; preserve and review before compiling');
 const android=path.join(root,'android'),appGradle=path.join(android,'app/build.gradle');
 const marker='// WB registered-home release signing';
 if(!fs.readFileSync(appGradle,'utf8').includes(marker))fs.appendFileSync(appGradle,`\n${marker}\ndef wbKey = new groovy.json.JsonSlurper().parse(new File(System.getenv('WB_LOCAL_CREDENTIALS'))).android.keystore\nandroid {\n defaultConfig { versionCode Integer.parseInt(System.getenv('WB_RELEASE_VERSION_CODE')) }\n signingConfigs { wbRegisteredRelease { storeFile new File(System.getenv('WB_LOCAL_KEYSTORE')); storePassword wbKey.keystorePassword; keyAlias wbKey.keyAlias; keyPassword wbKey.keyPassword } }\n buildTypes { release { signingConfig signingConfigs.wbRegisteredRelease } }\n}\n`);
 // Hash long dependency object paths inside this registered home. Do not move
 // or copy source to work around Windows Ninja's legacy filename limit.
 const objectMarker='// WB bounded CMake object paths';
 if(!fs.readFileSync(appGradle,'utf8').includes(objectMarker))fs.appendFileSync(appGradle,`\n${objectMarker}\nandroid { defaultConfig { externalNativeBuild { cmake { arguments "-DCMAKE_OBJECT_PATH_MAX=128" } } } }\n`);
 const stagingMarker='// WB generated-only CMake artifact staging';
 if(!fs.readFileSync(appGradle,'utf8').includes(stagingMarker))fs.appendFileSync(appGradle,`\n${stagingMarker}\nandroid { externalNativeBuild { cmake { buildStagingDirectory file("C:/dev/release-artifacts/native-cache/suite") } } }\n`);
 const local=path.join(android,'local.properties'),old=fs.existsSync(local)?fs.readFileSync(local,'utf8'):'';
 const sdkLine=`sdk.dir=${sdk}`;
 fs.writeFileSync(local,/^sdk.dir=.*$/m.test(old)?old.replace(/^sdk.dir=.*$/m,sdkLine):`${old}\n${sdkLine}\n`);
 guard();
 command(java,['-classpath',path.join(android,'gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain',':app:assembleRelease','-PreactNativeArchitectures=arm64-v8a','--build-cache','--max-workers=4','--console=plain'],android);
 guard();
 if(git('status','--porcelain')||git('rev-parse','HEAD')!==head||git('worktree','list','--porcelain')!==worktreesBefore)throw Error('Source/topology changed during build; hold artifact');
 const built=path.join(android,'app/build/outputs/apk/release/app-release.apk'),actual=identity(built);
 if(actual.package!==baseline.package||actual.versionCode!==version||actual.signingSha256!==signingSha256)throw Error('Built APK verification failed');
 const output=path.join('C:/dev/release-artifacts',`suite-${version}-${head.slice(0,7)}`);
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.mkdirSync(output,{recursive:false});
 const artifact=path.join(output,`com.wellbuilt.suite-vc${version}.apk`);fs.copyFileSync(built,artifact);
 const receipt={sourceCommit:head,branch,checkout:root,remote:git('remote','get-url','origin'),owner:reservation.owner,reservation:tag,reservationTagObject:git('rev-parse',tag),profile:profileName,buildMethod:'local Android SDK/Gradle in registered home',sourceCopy:false,cloudBuild:false,...actual,artifact,apkSha256:crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),completedAt:new Date().toISOString(),installed:false};
 fs.writeFileSync(path.join(output,'local-build.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt,null,2));return receipt;
}
module.exports={profileFor,validateReservation};
if(require.main===module){try{main();}catch(e){console.error(`REGISTERED BUILD STOPPED: ${e.message}`);process.exitCode=1;}}
