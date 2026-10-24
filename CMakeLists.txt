cmake_minimum_required(VERSION 3.19)

if (APPLE AND NOT CMAKE_OSX_ARCHITECTURES)
    set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "" FORCE)
endif()
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version")

project(airwindows-m4l LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(AW_DIR ${CMAKE_SOURCE_DIR}/libs/airwin2rack)
set(C74_MAX_API_DIR ${CMAKE_SOURCE_DIR}/libs/max-sdk-base)

# airwin2rack lists its generated sources relative to its own root
include(${AW_DIR}/src/autogen_airwin/CMakeLists.txt)
list(TRANSFORM AIRWIN_SOURCES PREPEND ${AW_DIR}/)

add_library(airwin-core STATIC
    source/core/aw_registry.cpp
    ${AW_DIR}/src/airwin_consolidated_base.cpp
    ${AIRWIN_SOURCES})
target_include_directories(airwin-core PUBLIC ${AW_DIR}/src source/core)
target_compile_definitions(airwin-core PRIVATE _USE_MATH_DEFINES)
if (MSVC)
    target_compile_options(airwin-core PRIVATE /bigobj /w)
else()
    target_compile_options(airwin-core PRIVATE -w)
endif()

add_subdirectory(source/projects/airwin_tilde)
add_subdirectory(tools/awtool)
if (APPLE)
    add_subdirectory(tools/nulltest)
endif()
