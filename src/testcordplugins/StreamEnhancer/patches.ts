/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Patch } from "@utils/types";

export const streamEnhancerPatches: Array<Omit<Patch, "plugin">> = [
    {
        find: "ConnectionEventFramerateReducer",
        replacement: [
            {
                match: /this\.framerateReductionTimeout=setTimeout/,
                replace: "this.framerateReductionTimeout=void 0&&setTimeout"
            },
            {
                match: /updateRemoteWantsFramerate\(\)\{/,
                replace: "$&if($self.shouldOverrideStreamResolution()){this.connection.remoteSinkWantsMaxFramerate=$self.getConfiguredStreamFps();}"
            }
        ]
    },
    {
        find: "applyQualityConstraints(e,t){let n=this.getQuality(t);return",
        replacement: [
            {
                match: /e\.encodingVideoWidth=n\.capture\.width,e\.encodingVideoHeight=n\.capture\.height,e\.encodingVideoFrameRate=n\.capture\.framerate,e\.captureVideoFrameRate=n\.capture\.framerate/,
                replace: "e.encodingVideoWidth=$self.getConfiguredStreamWidth(n?.capture?.width),e.encodingVideoHeight=$self.getConfiguredStreamHeight(n?.capture?.height),e.encodingVideoFrameRate=$self.getConfiguredStreamFps(n?.capture?.framerate),e.captureVideoFrameRate=$self.getConfiguredStreamFps(n?.capture?.framerate)"
            },
            {
                match: /e\.remoteSinkWantsMaxFramerate=n\.encode\.framerate,e\.remoteSinkWantsPixelCount=n\.encode\.pixelCount/,
                replace: "e.remoteSinkWantsMaxFramerate=$self.getConfiguredStreamFps(n?.encode?.framerate),e.remoteSinkWantsPixelCount=$self.getConfiguredStreamPixelCount(n?.encode?.pixelCount)"
            }
        ]
    },
    {
        find: "getVideoQuality(e){let t=this.ladder.getResolution(e)",
        replacement: {
            match: /return new a\(\{encode:\{\.\.\.t,framerate:\i\},capture:\{width:this\.options\.videoCapture\.width,height:this\.options\.videoCapture\.height,framerate:this\.options\.videoCapture\.framerate\}/,
            replace: "return new a({encode:{...t,framerate:$self.getConfiguredStreamFps()},capture:{width:$self.getConfiguredStreamWidth(),height:$self.getConfiguredStreamHeight(),framerate:$self.getConfiguredStreamFps()}",
            noWarn: true
        }
    },
    {
        find: "getDefaultGoliveQuality(){return new a({",
        replacement: [
            {
                match: /capture:\{width:1280,height:720,framerate:\i\.\i\}/,
                replace: "capture:{width:$self.getConfiguredStreamWidth(),height:$self.getConfiguredStreamHeight(),framerate:$self.getConfiguredStreamFps()}",
                noWarn: true
            },
            {
                match: /encode:\{width:1280,height:720,framerate:\i\.\i,pixelCount:921600\}/,
                replace: "encode:{width:$self.getConfiguredStreamWidth(),height:$self.getConfiguredStreamHeight(),framerate:$self.getConfiguredStreamFps(),pixelCount:$self.getConfiguredStreamPixelCount()}",
                noWarn: true
            }
        ]
    },
    {
        find: "canUseQuestOrbMultiplier:g",
        replacement: {
            match: /canUseQuestOrbMultiplier:\i/,
            replace: "canUseQuestOrbMultiplier:!0"
        }
    },
    {
        find: "\"canStreamWithSettings\"",
        replacement: {
            match: /\}\)\.allowAutoQuality;/,
            replace: "$&return!0;"
        }
    },
    {
        find: "RESOLUTION_720||t===",
        replacement: {
            match: /if\(\i!==\i\.on\.RESOLUTION_720\|\|\i===\i\.kn\.FPS_60\)return/,
            replace: "if(false)return"
        }
    },
    {
        find: "updateRemoteWantsFramerate(){",
        replacement: {
            match: /updateRemoteWantsFramerate\(\)\{/,
            replace: "$&if($self.shouldOverrideStreamResolution()){this.connection.remoteSinkWantsMaxFramerate=$self.getConfiguredStreamFps();}"
        }
    },
    {
        find: "Reduced framerate after",
        replacement: {
            match: /this\.framerateReductionTimeout=setTimeout/,
            replace: "this.framerateReductionTimeout=void 0&&setTimeout",
            noWarn: true
        }
    },
    {
        find: "setSDP(e){}setRemoteVideoSinkWants(",
        replacement: {
            match: /setRemoteVideoSinkWants\((\i)\)\{.{0,80}updateVideoQuality\((\i)\.(\i)\)\}/,
            replace: "setRemoteVideoSinkWants($1){this.remoteVideoSinkWants=$1;if($self.shouldOverrideStreamResolution()){this.remoteSinkWantsMaxFramerate=$self.getConfiguredStreamFps();}this.updateVideoQuality($2.$3)}"
        }
    },
    {
        find: "ApplicationStreamPreviewUploadManager",
        replacement: {
            match: /(\i)\.width=512,\1\.height=288/,
            replace: "$1.width=$self.getPreviewUploadWidth(),$1.height=$self.getPreviewUploadHeight()"
        }
    },
    {
        find: "go-live-modal",
        replacement: {
            match: /onBeforeShowModal:(\i),onOneClickGoLive:(\i)/,
            replace: "onBeforeShowModal:$1,onOneClickGoLive:$2,onContextMenu:e=>$self.openGoLiveButtonContextMenu(e,null)"
        }
    },
    {
        find: "r.t.fjBNo1):r.intl.string(r.t.uQn9B8)",
        replacement: {
            match: /onMouseLeave:(\i=>\{.{0,80}\}),\.\.\.(\i)\}/,
            replace: "onMouseLeave:$1,onContextMenu:e=>$self.openGoLiveButtonContextMenu(e,null),...$2}"
        }
    },
    {
        find: "ApplicationStreamPreviewUploadManager",
        replacement: {
            match: /,(\i)\?\.drawImage\(/,
            replace: ",$self.applyPreviewUploadFilter($1),$1?.drawImage("
        }
    },
    {
        find: "ApplicationStreamPreviewUploadManager",
        replacement: {
            match: /(\i)\.width=(\i)\.width,\1\.height=\2\.height/,
            replace: "$1.width=$self.getPreviewUploadWidth(),$1.height=$self.getPreviewUploadHeight()"
        }
    },
    {
        find: "ApplicationStreamPreviewUploadManager",
        replacement: {
            match: /(\i)=512\/(\i)\.width,(\i)=Math\.min\(\1,288\/\2\.height\),(\i)=\2\.width\*\3,(\i)=\2\.height\*\3/,
            replace: "$1=$self.getPreviewUploadWidth()/$2.width,$3=Math.min($1,$self.getPreviewUploadHeight()/$2.height),$4=$2.width*$3,$5=$2.height*$3"
        }
    },
    {
        find: "ApplicationStreamPreviewUploadManager",
        replacement: {
            match: /let (\i)=(\i)\.toDataURL\("image\/jpeg"\);/,
            replace: "let $1=$self.getPreviewUploadDataUrl($2);"
        }
    },
    {
        find: "Failed to post stream preview",
        replacement: {
            match: /(\i)===(\i)&&\((\i)\?(\i)\.start\(6e4,(\i)\):\4\.start\(3e5,\5\)\)/,
            replace: "$1===$2&&($3?$4.start($self.getPreviewRetryIntervalMs(),$5):$4.start($self.getPreviewRefreshIntervalMs(),$5))"
        }
    },
    {
        find: "updateVideoQuality(e){let t=this.videoStreamParameters.findIndex",
        replacement: {
            match: /-1===(\i)&&\(\1=0\);/,
            replace: "-1===$1&&($self.shouldOverrideStreamResolution()&&($1=this.videoStreamParameters.findIndex(e=>null!=e.maxPixelCount&&e.maxPixelCount===$self.getConfiguredStreamPixelCount())),-1===$1&&($1=0));"
        }
    },
    {
        find: "mediaEngineConnectionId=`WebRTC-",
        replacement: {
            match: /voiceBitrate=\i\.\i;/,
            replace: "voiceBitrate=$self.getConfiguredMicBitrate();"
        }
    },
    {
        find: "UnifiedConnection(",
        replacement: {
            match: /setBitRate\((\i)\)\{/,
            replace: "setBitRate($1){$1=$self.getConfiguredMicBitrate();"
        }
    },
    {
        find: "this.conn.setTransportOptions(this.getCodecOptions(",
        replacement: {
            match: /setVoiceBitRate\((\i)\)\{/,
            replace: "setVoiceBitRate($1){$1=$self.getConfiguredMicBitrate();"
        }
    },
    {
        find: "this.conn.setTransportOptions(this.getCodecOptions(",
        replacement: {
            match: /(\i)===(\i)\.(\i)\.STREAM&&\((\i)\.channels=2\)/,
            replace: "$self.applyMicCodecPreference($4,this.codecs,$1,$2.$3)"
        }
    },
    {
        find: "fmtp.push({config:",
        replacement: {
            match: /config:`minptime=10;useinbandfec=1;usedtx=\$\{\i\?"0":"1"\}`/,
            replace: "config:$self.getMicOpusFmtpConfig()"
        }
    },
    {
        find: "setDesktopEncodingOptions(",
        replacement: {
            match: /setDesktopEncodingOptions\((\i),(\i),(\i)\)\{/,
            replace: "setDesktopEncodingOptions($1,$2,$3){if(this.destroyed)return;$1=$self.getConfiguredStreamWidth($1);$2=$self.getConfiguredStreamHeight($2);$3=$self.getConfiguredStreamFps($3);"
        }
    },
    {
        find: "automaticGainControlConfig:this.automaticGainControl",
        replacement: [
            {
                match: /builtInEchoCancellation:!0/,
                replace: "builtInEchoCancellation:$self.getMicBuiltInEchoCancellationEnabled()"
            },
            {
                match: /echoCancellation:this\.echoCancellation/,
                replace: "echoCancellation:$self.getMicEchoCancellationEnabled()"
            },
            {
                match: /noiseSuppression:this\.noiseSuppression/,
                replace: "noiseSuppression:$self.getMicNoiseSuppressionEnabled()"
            },
            {
                match: /automaticGainControl:this\.automaticGainControl\.enabled/,
                replace: "automaticGainControl:$self.getMicAutoGainControlEnabled()"
            },
            {
                match: /automaticGainControlConfig:this\.automaticGainControl/,
                replace: "automaticGainControlConfig:$self.getMicTransportAutomaticGainControlConfig(this.automaticGainControl)"
            },
            {
                match: /noiseCancellation:this\.noiseCancellation/,
                replace: "noiseCancellation:$self.getMicNativeNoiseCancellationEnabled()"
            },
            {
                match: /noiseCancellationDuringProcessing:this\.noiseCancellationDuringProcessing/,
                replace: "noiseCancellationDuringProcessing:$self.getMicNativeNoiseCancellationEnabled()"
            },
        ]
    },
    {
        find: "prioritySpeakerDucking",
        replacement: [
            {
                match: /fec:!0/,
                replace: "fec:$self.getMicFecEnabled()"
            },
            {
                match: /packetLossRate:\.3/,
                replace: "packetLossRate:$self.getMicPacketLossRate()"
            },
            {
                match: /encodingVoiceBitRate:this\.voiceBitrate/,
                replace: "encodingVoiceBitRate:$self.getConfiguredMicBitrate()"
            },
            {
                match: /callBitRate:\i\.\i/,
                replace: "callBitRate:$self.getConfiguredMicBitrate()"
            },
            {
                match: /callMinBitRate:\i\.\i/,
                replace: "callMinBitRate:$self.getConfiguredMicBitrate()"
            },
            {
                match: /callMaxBitRate:\i\.\i/,
                replace: "callMaxBitRate:$self.getConfiguredMicBitrate()"
            }
        ]
    },
    {
        find: "noiseCancellationSupported:I,noiseCancellationEnableStats:D,vadDuringPreProcess:T",
        replacement: {
            match: /vadDuringPreProcess:T/,
            replace: "$&",
            noWarn: true
        }
    },
    {
        find: "this.vadUseKrisp=",
        replacement: {
            match: /this\.vadThreshold=(\i)\.vadThreshold.{0,120}this\.vadTrailing=\1\.vadTrailing/,
            replace: "this.vadThreshold=$1.vadThreshold,this.vadAutoThreshold=$1.vadAutoThreshold,this.vadUseKrisp=$self.getMicNativeKrispEnabled(),this.vadLeading=$1.vadLeading,this.vadTrailing=$1.vadTrailing"
        }
    },
    {
        find: "setGoLiveSource({desktopDescription:{",
        replacement: {
            match: /(setGoLiveSource\(\{desktopDescription:\{.{0,500}hdrCaptureMode:)(\i)/,
            replace: "$1$self.getHdrCaptureMode($2)"
        }
    },
    {
        find: "2026-02-go-live-hdr",
        replacement: {
            match: /return (\i)\.getConfig\(\{location:(\i)\}\)/,
            replace: "return $self.getGoLiveHdrExperimentConfig($1.getConfig({location:$2}))"
        }
    },
    {
        find: "AUDIO_VOLUME_CHANGE",
        replacement: {
            match: /\{inputVolume:(\i)\((\i)\)\}\),(\i)\.setInputVolume\(\2\)/,
            replace: "{inputVolume:$1($2,$self.getMaxMicInputVolume())}),$3.setInputVolume($2)"
        }
    },
    {
        find: "case\"video\":(t?[P.UK.H265",
        replacement: {
            match: /\(\i\?\[(\i)\.UK\.H265,\1\.UK\.H264,\1\.UK\.VP8,\1\.UK\.VP9\]:\[\1\.UK\.H264,\1\.UK\.VP8,\1\.UK\.VP9\]\)\.forEach/,
            replace: "$self.getPreferredVideoCodecOrder($1.UK,t).forEach"
        }
    },
    {
        find: "this.conn.setTransportOptions(this.getCodecOptions(",
        replacement: {
            match: /setCodecs\((\i),(\i),(\i)\)\{/,
            replace: "setCodecs($1,$2,$3){$2=$self.getPreferredVideoCodecName($2,null!=$3);"
        }
    },
    {
        find: "videoCapture.width",
        replacement: {
            match: /width:this\.options\.videoCapture\.width,height:this\.options\.videoCapture\.height,framerate:this\.options\.videoCapture\.framerate/,
            replace: "capture:{width:$self.getConfiguredStreamWidth(),height:$self.getConfiguredStreamHeight(),framerate:$self.getConfiguredStreamFps()}"
        }
    },
    {
        find: "setQualityOverwrite(e){this.qualityOverwrite=e}setGoliveQuality(",
        replacement: {
            match: /setGoliveQuality\((\i)\)\{/,
            replace: "setGoliveQuality($1){$1=$self.normalizeGoLiveQualityOverride($1);"
        }
    },
    {
        find: "Invalid arguments.",
        replacement: [
            {
                match: /capture:\{width:1280,height:720,framerate:\i\.\i\}/,
                replace: "capture:{width:$self.getConfiguredStreamWidth(),height:$self.getConfiguredStreamHeight(),framerate:$self.getConfiguredStreamFps()}",
                noWarn: true
            },
            {
                match: /encode:\{width:1280,height:720,framerate:\i\.\i,pixelCount:921600\}/,
                replace: "encode:{width:$self.getConfiguredStreamWidth(),height:$self.getConfiguredStreamHeight(),framerate:$self.getConfiguredStreamFps(),pixelCount:$self.getConfiguredStreamPixelCount()}",
                noWarn: true
            },
            {
                match: /bitrateTarget:this\.options\.desktopBitrate\.target/,
                replace: "bitrateTarget:$self.getConfiguredStreamBitrateTarget()"
            }
        ]
    },
    {
        find: "applyQualityConstraints(e,t){let n=this.getQuality(t);return",
        replacement: [
            {
                match: /null!=\i\.bitrateTarget\?(\i)\.encodingVideoBitRate=\i\.bitrateTarget:\1\.encodingVideoBitRate=\i\.bitrateMax/,
                replace: "$1.encodingVideoBitRate=$self.getConfiguredStreamBitrateTarget()"
            },
            {
                match: /(\i)\.encodingVideoMinBitRate=\i\.bitrateMin/,
                replace: "$1.encodingVideoMinBitRate=$self.getConfiguredStreamBitrateMin()"
            },
            {
                match: /(\i)\.encodingVideoMaxBitRate=\i\.bitrateMax/,
                replace: "$1.encodingVideoMaxBitRate=$self.getConfiguredStreamBitrateMax()"
            }
        ]
    },
    {
        find: "mediaEngineConnectionId=`WebRTC-",
        replacement: {
            match: /maxFrameRate:(\i)\.capture\?\.framerate,maxResolution:\{type:(\i)\.(\i)\.FIXED,width:\1\.capture\?\.width,height:\1\.capture\?\.height\}/,
            replace: "maxFrameRate:$self.getConfiguredStreamFps($1?.capture?.framerate),maxResolution:{type:$2.$3.FIXED,width:$self.getConfiguredStreamWidth($1?.capture?.width),height:$self.getConfiguredStreamHeight($1?.capture?.height)}"
        }
    },
    {
        find: "stream_quality_guild_premium_tier",
        replacement: {
            match: /function (\i)\((\i)\)\{return null!=\2\.quality.{0,30}\}/,
            replace: "function $1($2){return false}"
        }
    },
    {
        find: "stream_quality_guild_premium_tier",
        replacement: {
            match: /stream_quality_user_premium_tier:\i\?\.quality!=null\?\i\.\i\[\i\.quality\]:null,stream_quality_guild_premium_tier:\i\?\.guildPremiumTier/,
            replace: "stream_quality_user_premium_tier:null,stream_quality_guild_premium_tier:null"
        }
    },
    {
        find: "ChannelRTCStore\");",
        replacement: {
            match: /let\{channelId:(\i),senderUserId:(\i),maxResolution:(\i),maxFrameRate:(\i)\}=(\i);/,
            replace: "let{channelId:$1,senderUserId:$2,maxResolution:$3,maxFrameRate:$4}=$5;$3=$self.coerceParticipantResolution($3),$4=$self.coerceParticipantFrameRate($4);"
        }
    },
    {
        find: "ChannelRTCStore\");",
        replacement: {
            match: /updateParticipantQuality\((\i),(\i),(\i)\)/,
            replace: "updateParticipantQuality($1,$self.coerceParticipantResolution($2),$self.coerceParticipantFrameRate($3))"
        }
    },
    {
        find: "__EMBEDDED_ACTIVITIES__",
        replacement: {
            match: /maxResolution:(\i),maxFrameRate:(\i)/,
            replace: "maxResolution:$self.coerceParticipantResolution($1),maxFrameRate:$self.coerceParticipantFrameRate($2)"
        }
    },
    {
        find: "function T(e){return null==e.maxResolution",
        replacement: {
            match: /maxFrameRate:(\i)\.maxFrameRate,maxResolution:(\i)\.maxResolution/,
            replace: "maxFrameRate:$self.coerceParticipantFrameRate($1.maxFrameRate),maxResolution:$self.coerceParticipantResolution($2.maxResolution)"
        }
    },
    {
        find: "maxResolution:{height:t.resolution,width:0,type:0===t.resolution",
        replacement: {
            match: /maxFrameRate:(\i)\.fps,maxResolution:\{height:\1\.resolution,width:0,type:0===\1\.resolution\?\i\.ei\.SOURCE:\i\.ei\.FIXED\}/,
            replace: "maxFrameRate:$self.getConfiguredStreamFps($1.fps),maxResolution:$self.makeSelfResolutionFromSetting($1.resolution)"
        }
    },
    {
        find: "m.intl.string(m.t.XjXqzh):m.intl.formatToPlainString(m.t.TEOC0I",
        replacement: {
            match: /resolution:e\.height/,
            replace: "resolution:$self.getDisplayResolutionForLabel(e)"
        }
    },
    {
        find: "handleFullScreenChange",
        replacement: {
            match: /,(\i\?\(0,\i\.jsx\)\(\i\.A,\{.{0,180}?onClick:\(\)=>\{.{0,120}?this\.handleFullScreen\(\)\}\}\):null)/,
            replace: ",null!=this.props.selectedParticipant&&$self.isMediaParticipant(this.props.selectedParticipant)?$self.renderViewerControls(this.props.selectedParticipant):null,$1"
        }
    },
    {
        find: "showParticipants:S=!0,width:R,height:L,idle:O,mode:P,popoutType:M,awaitingRemoteSessionInfo:w,callContainerDimensions:U}=e;l.useEffect",
        replacement: {
            match: /showParticipants:(\i)=!0,width:(\i),height:(\i),idle:(\i),mode:(\i),popoutType:(\i),awaitingRemoteSessionInfo:(\i),callContainerDimensions:(\i)\}=e;/,
            replace: "showParticipants:$1=!0,width:$2,height:$3,idle:$4,mode:$5,popoutType:$6,awaitingRemoteSessionInfo:$7,callContainerDimensions:$8}=e;vcShowParticipants=$self.useShowStreamParticipants($1);"
        }
    },
    {
        find: "zoom-controls",
        replacement: {
            match: /paused:(\i)\},"zoom-controls"/,
            replace: 'paused:$1,showPreview:null!=arguments[0].streamId},"zoom-controls"'
        }
    },
    {
        find: "type:\"set_source_type\",sourceType:",
        replacement: {
            match: /\{state:(\i),dispatch:(\i)\}=(function\(\i,\i,\i\)\{let\{defaultAutoQuality:\i,allowAutoQuality:\i\}=.{0,500}?let\[\i,\i\]=\i\.useReducer\(.{0,360}?return \i\.useEffect\(.{0,280}?\},\[\]\),\{state:\i,dispatch:\i\}\}\(\i,\i,\i\(\)\))/,
            replace: "{state:$1,dispatch:$2}=$self.syncGoLiveModalState($3)"
        }
    },
    {
        find: "type:\"set_source_type\",sourceType:",
        replacement: {
            match: /return ((\i)\|\|(\i)\.splice\(1,0,\{name:.{0,160}?value:\i\.fS\.SCREEN,icon:\i\.k\}\)),\3\},\[\2\]\)/,
            replace: "return $1,$3.some(option=>option.value===$self.getGoLiveStreamEnhanceSourceType())?$3:[...$3,$self.getGoLiveStreamEnhanceSourceOption()]},[$2])"
        }
    },
    {
        find: "type:\"set_source_type\",sourceType:",
        replacement: {
            match: /children:(\i)&&(\i)!==(\i)\.fS\.CAMERA\?\(0,(\i)\.jsx\)\((\i),\{onSourceSelect:(\i)\}\):\(0,\4\.jsx\)\((\i),\{onClick:/,
            replace: "children:$2===$self.getGoLiveStreamEnhanceSourceType()?$self.renderGoLiveStreamEnhancePanel():$1&&$2!==$3.fS.CAMERA?(0,$4.jsx)($5,{onSourceSelect:$6}):(0,$4.jsx)($7,{onClick:"
        }
    },
    {
        find: "secureFramesVerified:",
        replacement: {
            match: /streamId:(\i)\.type===\i\.lp\.STREAM\?\1\.streamId:null/,
            replace: "streamId:$1.streamId"
        }
    },
    {
        find: "#{intl::YCvOsO::raw}",
        replacement: [
            {
                match: /let \i,\i,\i,\{participant:(\i).{0,220}?width:(\i).{0,190}?fit:(\i)=.{0,140}?controlsBottom:\i\}=e/,
                replace: "$&,vcRenderedWidth=$self.useRenderedWidthFromProps({participant:$1},$2),vcState=$self.useRenderedStreamVideoState($1.id,$3)"
            },
            {
                match: /width:\i,fit:(\i),onVideoResize:(\i),paused:(\i),popoutType:(\i)/,
                replace: "width:vcRenderedWidth,fit:$1,onVideoResize:$2,paused:$3,popoutType:$4"
            },
            {
                match: /(\(0,\i\.jsx\)\(\i\.A,\{participant:\i,selected:\i,popoutType:\i,width:\i,fit:\i,onVideoResize:\i,paused:\i)\}/,
                replace: "$1,fit:vcState.fit,className:vcState.className,style:vcState.style,wrapperClassName:vcState.wrapperClassName,wrapperStyle:vcState.wrapperStyle}"
            }
        ]
    },
    {
        find: ",{streamId:n,onResize:s,wrapperClassName:a}=t,{onActive:o}",
        replacement: [
            {
                match: /,\{streamId:\i,onResize:\i,wrapperClassName:\i\}=t,/,
                replace: "$&vcWrapperStyle=$self.getRenderedMediaWrapperStyle(t.style,t.wrapperStyle),"
            },
            {
                match: /className:r\(\)\(\i\.iE,\i,\{[^}]*\}\)(?=,onMouseDown:\i,onMouseMove:\i,onMouseUp:\i,onMouseLeave:\i,onWheel:\i,onClick:\i)/,
                replace: "$&,style:vcWrapperStyle"
            }
        ]
    },
    {
        find: "REMOTE_VIDEO,paused:",
        replacement: [
            {
                match: /function \i\(\i\)\{let\{participant:(\i),channel:\i,inCall:\i,width:\i,selected:\i,popoutType:\i,fit:(\i),onVideoResize:\i,blocked:\i,ignored:\i,noVideoRender:\i=!1.{0,120}\}=\i,/,
                replace: "$&vcState=$self.useRenderedStreamVideoState($1?.id,$2),"
            },
            {
                match: /\(0,\i\.jsx\)\(\i\.A,\{onResize:(\i),wrapperClassName:(\i!==\i\.\i\.CALL_TILE\?\i\.\i:void 0),/,
                replace: "$self.renderZoomableCameraVideo({onResize:$1,wrapperClassName:$self.getRenderedMediaWrapperClassName($2,vcState.wrapperClassName),"
            },
            {
                match: /className:(\i\.\i),mirror:/,
                replace: "className:vcState.className,mirror:"
            },
            {
                match: /fit:\i,videoSpinnerContext:/,
                replace: "fit:vcState.fit,style:vcState.style,wrapperStyle:vcState.wrapperStyle,streamKey:t.id,videoSpinnerContext:"
            }
        ]
    },
    {
        find: "REMOTE_STREAM,userId:",
        replacement: [
            {
                match: /function (\i)\((\i)\)\{let\{participant:(\i),selected:(\i),onVideoResize:/,
                replace: "function $1($2){if(null==$2?.participant)return null;let{participant:$3,selected:$4,onVideoResize:"
            },
            {
                match: /(\{stream:\i,user:\i,streamId:\i\}=(\i),)/,
                replace: "vcState=$self.useRenderedStreamVideoState($2?.id,g),$1"
            },
            {
                match: /wrapperClassName:((?:\i\(\)\()?\i!==\i\.\i\.CALL_TILE\?\i\.\i:void 0,\i)\),className:/,
                replace: "wrapperClassName:$1,vcState.wrapperClassName),className:"
            },
            {
                match: /className:(\i\.\i),streamId:(\i),videoComponent:(\i),fit:(\i),paused:/,
                replace: "className:vcState.className,streamId:$2,videoComponent:$3,fit:vcState.fit,style:vcState.style,paused:"
            }
        ]
    },
    {
        find: "showParticipants:M=!0,className:w,width:U,height:D,layout:V,idle:k}=e,G=m.Ay",
        replacement: [
            {
                match: /showParticipants:(\i)=!0,className:(\i),width:(\i),height:(\i),layout:(\i),idle:(\i)\}=e,/,
                replace: "showParticipants:$1=!0,className:$2,width:$3,height:$4,layout:$5,idle:$6}=e,vcShowParticipants=$self.useShowStreamParticipants($1),vcSelectedRootClassName=$self.useSelectedRootClassName(),"
            },
            {
                match: /className:(\i)\(\)\((\i)\.zr,(\i)\.tR,(\i)\),children:/,
                replace: "className:$1()($2.zr,$3.tR,$4,vcSelectedRootClassName),children:"
            },
            {
                match: /className:(\i)\(\)\((.{0,80}?)\),style:\{bottom:(\i)\.value\},children:/,
                replace: "className:$self.getActionRowClassName($1()($2)),style:{bottom:$3.value},children:"
            },
            {
                match: /className:(\i)\.Vx,style:\{([^{}]{0,180}?)\}(?=,children:\(0,\i\.jsx\)\(\i\.Ay)/,
                replace: "className:$self.getParticipantsWrapperClassName($1.Vx),style:$self.getParticipantsWrapperStyle({$2})"
            }
        ]
    },
    {
        find: "Q=D<=2*b+144,J=M&&!Q",
        replacement: {
            match: /J=(\i)&&!(\i)/,
            replace: "J=vcShowParticipants&&!$2"
        }
    },
    {
        find: "streamPreviewURL",
        replacement: [
            {
                match: /\[(\i),(\i)\]=(\i)\.useState\(!0\)/,
                replace: "[$1,$2]=$3.useState(!0),vcState=$self.useRenderedStreamVideoState(arguments[0].streamKey,arguments[0].fit)"
            },
            {
                match: /\(0,(\i)\.t\)\((\i),"video",\i\)/,
                replace: "(0,$1.t)($2,\"video\",vcState.fit)"
            }
        ]
    },
    {
        find: "--custom-zoom-minimap-width",
        replacement: [
            {
                match: /let\{mirror:(\i)=!1,streamId:(\i),paused:(\i)\}=e/,
                replace: "let{mirror:$1=!1,streamId:$2,paused:$3,showPreview:re=!0,compactPreview:ce=!1}=e"
            },
            {
                match: /let (\i)=120\*Math\.min\((\i),32\/9\);return\{"--custom-zoom-minimap-width":`\$\{\1\}px`,"--custom-zoom-minimap-height":"120px"\}\},\[\2\]\)/,
                replace: "let $1=(ce?80:120)*Math.min($2,32/9),minimapHeight=ce?\"80px\":\"120px\";return{\"--custom-zoom-minimap-width\":`${$1}px`,\"--custom-zoom-minimap-height\":minimapHeight}},[$2,ce])"
            }
        ]
    },
    {
        find: "reportContainerResized:!1",
        replacement: {
            match: /\((\i)\|\|(\i)\)&&\(0,(\i)\.jsx\)\((\i)\.(\i),/,
            replace: "e.showPreview!==!1&&($1||$2)&&(0,$3.jsx)($4.$5,"
        }
    },
];
